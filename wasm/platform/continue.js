// Continue playing: remembers the last app streamed, offers it on the home screen, and can start it
// by itself when VibeLight opens (the "Resume on launch" setting of the Host Settings).

var LAST_PLAYED_KEY = 'lastPlayed';
var AUTO_RESUME_KEY = 'autoResume';
var AUTO_RESUME_SECONDS = 5; // Countdown before the last app starts by itself

var ContinuePlaying = (function() {
  var lastPlayed = null;
  var hostsLoaded = false;
  var uiReady = false;
  var launchOfferDone = false;
  var countdownTimer = null;
  var countdownLeft = 0;
  var starting = false;

  function load(callback) {
    getData(LAST_PLAYED_KEY, function(stored) {
      var value = stored ? stored[LAST_PLAYED_KEY] : null;
      lastPlayed = value && value.hostUid && value.appId !== undefined && value.appId !== null ? value : null;
      if (callback) {
        callback();
      }
    });
  }

  // Called when a stream is connected, with the metadata of its statistics session (see stats.js)
  function remember(meta) {
    if (!meta || !meta.hostUid || !meta.config || meta.config.appId === undefined) {
      return;
    }
    lastPlayed = {
      hostUid: meta.hostUid,
      hostName: meta.hostName || '',
      appId: meta.config.appId,
      appName: meta.appName || '',
      at: Date.now(),
    };
    storeData(LAST_PLAYED_KEY, lastPlayed, null);
  }

  function host() {
    return lastPlayed && typeof hosts === 'object' && hosts ? hosts[lastPlayed.hostUid] : null;
  }

  // The banner is offered for a paired host that is still in the list
  function isAvailable() {
    var lastHost = host();
    return !!(lastHost && lastHost.paired);
  }

  function isVisible() {
    return $('#continue-banner').is(':visible');
  }

  function timeAgo(timestamp) {
    var minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) {
      return t('just now');
    }
    if (minutes < 60) {
      return t('%1$s min ago', minutes);
    }
    var hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return t('%1$s h ago', hours);
    }
    return t('%1$s days ago', Math.floor(hours / 24));
  }

  function renderArt(lastHost) {
    var art = $('#continueArt');
    art.css('backgroundImage', '').removeClass('has-art');
    if (!lastHost || typeof lastHost.getBoxArt !== 'function') {
      return;
    }
    var appId = lastPlayed.appId;
    // The box art is read from the cache of the host, or downloaded when the host is online
    lastHost.getBoxArt(appId, false).then(function(url) {
      if (url && lastPlayed && lastPlayed.appId === appId) {
        art.css('backgroundImage', 'url("' + String(url).replace(/"/g, '%22') + '")').addClass('has-art');
      }
    }, function() {
      // Keep the gradient placeholder
    });
  }

  // Show or hide the banner of the Hosts view, with the last app and its host
  function render() {
    var banner = $('#continue-banner');
    var hostsViewShown = $('#host-grid').is(':visible');
    if (!isAvailable() || !hostsViewShown) {
      banner.hide();
      cancelCountdown();
      // Move the focus away from a banner that disappeared
      if (hostsViewShown && typeof Navigation.current === 'function' && Navigation.current() === Views.ContinueBanner) {
        Navigation.change(Views.Hosts);
        Views.Hosts.switch();
      }
      return;
    }
    var lastHost = host();
    $('#continueTitle').text(lastPlayed.appName || t('Stream'));
    $('#continueSubtitle').text((lastHost.hostname || lastPlayed.hostName) + ' · ' + timeAgo(lastPlayed.at));
    banner.attr('data-host-status', lastHost.online === false ? 'offline' : 'online');
    if (!banner.is(':visible')) {
      banner.show();
      renderArt(lastHost);
    }
  }

  function isAutoResumeEnabled() {
    var toggle = document.getElementById('autoResumeSwitch');
    return !!(toggle && toggle.checked);
  }

  function updateCountdown() {
    $('#continueCountdownText').text(t('Starting in %1$s s', countdownLeft));
    $('#continueCountdownBar').css('width', (countdownLeft / AUTO_RESUME_SECONDS * 100) + '%');
  }

  function startCountdown() {
    cancelCountdown();
    countdownLeft = AUTO_RESUME_SECONDS;
    $('#continue-banner').addClass('is-counting');
    updateCountdown();
    countdownTimer = setInterval(function() {
      countdownLeft--;
      if (countdownLeft <= 0) {
        start();
        return;
      }
      updateCountdown();
    }, 1000);
  }

  // Stop the automatic start, returns whether a countdown was running
  function cancelCountdown() {
    $('#continue-banner').removeClass('is-counting');
    if (countdownTimer === null) {
      return false;
    }
    clearInterval(countdownTimer);
    countdownTimer = null;
    return true;
  }

  // Start the last app: wake the host when needed, check the app still exists, then stream it
  function start() {
    cancelCountdown();
    if (!isAvailable() || starting) {
      return;
    }
    starting = true;
    setTimeout(function() {
      starting = false;
    }, 3000);
    console.log('%c[continue.js, start]', 'color: teal;', 'Continue playing ' + lastPlayed.appName + ' on ' + lastPlayed.hostName);
    snackbarLog('Starting %1$s on %2$s...', lastPlayed.appName || t('Stream'), host().hostname);
    waitForHostAndNavigateToApp(lastPlayed.hostUid, lastPlayed.appId);
  }

  function focusBanner() {
    if (typeof Navigation.current === 'function' && Navigation.current() !== Views.Hosts) {
      return false;
    }
    Navigation.change(Views.ContinueBanner);
    Navigation.switch();
    return true;
  }

  // At launch, focus the banner once the hosts and the interface are ready, and start the
  // countdown of the automatic start when it is enabled
  function offerOnLaunch() {
    if (launchOfferDone || !hostsLoaded || !uiReady) {
      return;
    }
    launchOfferDone = true;
    render();
    if (!isVisible() || deepLinkRequested || isDialogOpen) {
      return;
    }
    if (focusBanner() && isAutoResumeEnabled()) {
      startCountdown();
    }
  }

  return {
    remember: remember,
    render: render,
    start: start,
    isVisible: isVisible,
    cancelCountdown: cancelCountdown,
    onHostsLoaded: function() {
      load(function() {
        hostsLoaded = true;
        render();
        offerOnLaunch();
      });
    },
    onUiReady: function() {
      uiReady = true;
      offerOnLaunch();
    },
  };
})();

function loadContinueSettings() {
  getData(AUTO_RESUME_KEY, function(stored) {
    var toggle = document.querySelector('#autoResumeBtn').MaterialSwitch;
    if (stored[AUTO_RESUME_KEY]) {
      toggle.on();
    } else {
      toggle.off();
    }
  });
}

function restoreContinueDefaults() {
  document.querySelector('#autoResumeBtn').MaterialSwitch.off();
  storeData(AUTO_RESUME_KEY, false, null);
}

function attachContinueListeners() {
  $('#continue-banner').on('click', function() {
    ContinuePlaying.start();
  });
  $('#autoResumeSwitch').on('click', function() {
    setTimeout(() => {
      var enabled = $('#autoResumeSwitch').parent().hasClass('is-checked');
      console.log('%c[continue.js, attachContinueListeners]', 'color: teal;', 'Saving autoResume state: ' + enabled);
      storeData(AUTO_RESUME_KEY, enabled, null);
    }, 100);
  });
}
