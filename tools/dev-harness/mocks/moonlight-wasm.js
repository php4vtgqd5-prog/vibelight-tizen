// Development harness: stand-in for the moonlight-wasm module and a simulated Sunshine host.
//
// common.js creates the global `Module` object and then loads this script in place of the real
// WebAssembly module. The functions below answer the requests of the user interface the way the
// WASM module does, backed by a fake host on 192.168.1.50 and a simulated streaming session.
//
// Query string options (see also mocks/tizen.js):
//
//   ?scenario=paired   Start with the fake host already paired (default), or `fresh` for no hosts
//   &hostCodecs=h264,hevc,hevc10,av1,av110   Codecs the host can encode
//   &rtt=3&jitter=1    Round-trip time and jitter of the simulated network, in milliseconds
//   &capacity=80       Throughput of the simulated network in Mbps, frames are lost above it
//   &loss=0            Random frame loss of the simulated network, in percent
//   &renderLimit=0     Highest frame rate the simulated TV decoder renders, 0 for no limit
//   &freeze=0          1 simulates a TV whose video stops after the first frame in the Ultra Low
//                      latency mode of Game Mode: the player then rejects the frames
//   &ultraLow=1        0 simulates a WASM player that reports no Ultra Low latency mode
//   &running=20002     Id of an app that already runs on the host
//
// Nothing here is shipped with the widget.
(function(global) {
  'use strict';

  var params = new URLSearchParams(global.location.search);
  var numberParam = function(name, fallback) {
    var value = parseFloat(params.get(name));
    return isNaN(value) ? fallback : value;
  };

  var SCM = { h264: 0x1, hevc: 0x100, hevc10: 0x200, av1: 0x10000, av110: 0x20000 };
  var codecSupport = (params.get('hostCodecs') || 'h264,hevc,hevc10,av1,av110').split(',').reduce(function(mask, name) {
    return mask | (SCM[name] || 0);
  }, 0);

  var network = {
    rtt: numberParam('rtt', 3),
    jitter: numberParam('jitter', 1),
    capacity: numberParam('capacity', 80),
    loss: numberParam('loss', 0),
  };

  var fakeHost = {
    address: '192.168.1.50',
    hostname: 'GAMING-PC',
    uniqueid: '4F8A2C1B-7D3E-4A56-9B21-C0FFEE123456',
    mac: '3C:7C:3F:12:34:56',
    paired: params.get('scenario') !== 'fresh',
    currentGame: numberParam('running', 0),
    apps: [
      { id: 881448767, title: 'Desktop' },
      { id: 1093255277, title: 'Steam Big Picture' },
      { id: 20001, title: 'Cyberpunk 2077' },
      { id: 20002, title: 'Elden Ring' },
      { id: 20003, title: 'Forza Horizon 5' },
      { id: 20004, title: 'Baldur\'s Gate 3' },
      { id: 20005, title: 'Hades II' },
      { id: 20006, title: 'Rocket League' },
    ],
  };

  function log(message) {
    console.log('%c[harness]', 'color: #b388ff;', message);
  }

  function later(ms, fn) {
    setTimeout(fn, ms);
  }

  function networkDelay() {
    return Math.max(1, network.rtt + (Math.random() * 2 - 1) * network.jitter);
  }

  function hostAddressOf(url) {
    var match = /^https?:\/\/\[?([^\]\/:]+)\]?(?::\d+)?/.exec(url);
    return match ? match[1] : '';
  }

  function isFakeHost(url) {
    var address = hostAddressOf(url);
    return address === fakeHost.address || address === fakeHost.hostname || address === fakeHost.hostname + '.local';
  }

  function serverInfoXml() {
    var busy = fakeHost.currentGame !== 0;
    return '<?xml version="1.0" encoding="utf-8"?>' +
      '<root status_code="200">' +
      '<hostname>' + fakeHost.hostname + '</hostname>' +
      '<appversion>7.1.431.-1</appversion>' +
      '<GfeVersion>3.23.0.74</GfeVersion>' +
      '<uniqueid>' + fakeHost.uniqueid + '</uniqueid>' +
      '<HttpsPort>47984</HttpsPort>' +
      '<ExternalPort>47989</ExternalPort>' +
      '<MaxLumaPixelsHEVC>1869449984</MaxLumaPixelsHEVC>' +
      '<mac>' + fakeHost.mac + '</mac>' +
      '<LocalIP>' + fakeHost.address + '</LocalIP>' +
      '<ServerCodecModeSupport>' + codecSupport + '</ServerCodecModeSupport>' +
      '<PairStatus>' + (fakeHost.paired ? 1 : 0) + '</PairStatus>' +
      '<currentgame>' + fakeHost.currentGame + '</currentgame>' +
      '<state>' + (busy ? 'SUNSHINE_SERVER_BUSY' : 'SUNSHINE_SERVER_FREE') + '</state>' +
      '<numofapps>' + fakeHost.apps.length + '</numofapps>' +
      '<gputype>NVIDIA GeForce RTX 4070</gputype>' +
      '</root>';
  }

  function appListXml() {
    return '<?xml version="1.0" encoding="utf-8"?><root status_code="200">' +
      fakeHost.apps.map(function(app) {
        return '<App><IsHdrSupported>1</IsHdrSupported><AppTitle>' + app.title.replace(/&/g, '&amp;').replace(/'/g, '&apos;') +
          '</AppTitle><ID>' + app.id + '</ID></App>';
      }).join('') + '</root>';
  }

  // Paints a box art for an app, so the app grid looks like it does with a real host
  function boxArtBytes(appId) {
    var app = fakeHost.apps.find(function(entry) { return entry.id === appId; }) || { title: 'App ' + appId };
    var hue = Math.abs(app.title.split('').reduce(function(hash, c) { return (hash * 31 + c.charCodeAt(0)) | 0; }, 7)) % 360;
    var canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 400;
    var context = canvas.getContext('2d');
    var gradient = context.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, 'hsl(' + hue + ', 70%, 45%)');
    gradient.addColorStop(1, 'hsl(' + ((hue + 60) % 360) + ', 70%, 18%)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 300, 400);
    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    for (var i = 0; i < 6; i++) {
      context.beginPath();
      context.arc(40 + i * 50, 120 + (i % 2) * 60, 30 + i * 6, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = '#fff';
    context.font = 'bold 30px Roboto, sans-serif';
    context.textAlign = 'center';
    var words = app.title.split(' ');
    words.forEach(function(word, index) {
      context.fillText(word, 150, 250 + index * 36);
    });
    return new Promise(function(resolve) {
      canvas.toBlob(function(blob) {
        blob.arrayBuffer().then(function(buffer) {
          resolve(new Uint8Array(buffer));
        });
      }, 'image/png');
    });
  }

  function answer(callbackId, type, response, delay) {
    later(delay === undefined ? networkDelay() : delay, function() {
      global.handlePromiseMessage(callbackId, type, response);
    });
  }

  function post(message, delay) {
    later(delay || 0, function() {
      global.handleMessage(message);
    });
  }

  // Simulated streaming session ------------------------------------------------------------------

  var session = null;

  var CODEC_NAMES = { H264: 'H.264', HEVC: 'HEVC', AV1: 'AV1' };

  function startSession(config) {
    var stream = {
      config: config,
      startedAt: 0,
      timer: null,
      // The video of a TV that freezes in the Ultra Low latency mode stops after the first frame
      frozen: params.get('freeze') === '1' && !!config.latencyMode,
    };
    session = stream;

    post('ProgressMsg: Starting RTSP handshake...', 150);
    post('ProgressMsg: Starting control stream establishment...', 450);
    post('ProgressMsg: Starting video stream establishment...', 700);
    later(1000, function() {
      if (session !== stream) {
        return;
      }
      stream.startedAt = Date.now();
      showFakeGameFrame(config);
      global.handleMessage('Connection Established');
      stream.timer = setInterval(function() { postStats(stream); }, 1000);
    });
  }

  // Stream statistics in the format of the StatsJson message of the WASM module
  function postStats(stream) {
    var config = stream.config;
    var bitrateMbps = config.bitrate / 1000;
    var overload = Math.max(0, bitrateMbps / network.capacity - 1);
    var lossPercent = Math.min(60, network.loss + overload * 45 + Math.random() * 0.1);
    var renderLimit = numberParam('renderLimit', 0);
    var received = config.fps * (1 - lossPercent / 100) * (0.995 + Math.random() * 0.01);
    var rendered = renderLimit > 0 ? Math.min(received, renderLimit) : received;
    var elapsed = (Date.now() - stream.startedAt) / 1000;
    if (stream.frozen && elapsed > 1) {
      // The player keeps the first frame on screen and rejects the following ones
      rendered = received * 0.02;
    } else {
      stream.position = elapsed;
    }
    var hostLatency = 3 + Math.random() * 2 + (config.width * config.height > 2073600 ? 2 : 0);
    var stats = {
      t: (Date.now() - stream.startedAt) / 1000,
      w: config.width,
      h: config.height,
      fps: config.fps,
      codec: (CODEC_NAMES[config.codec] || config.codec) + (config.hdr && config.codec !== 'H264' ? ' 10-bit' : ''),
      hdr: config.hdr ? 1 : 0,
      rx: received,
      dec: received,
      ren: rendered,
      mbps: Math.min(bitrateMbps, network.capacity) * (0.85 + Math.random() * 0.2),
      loss: lossPercent,
      fail: rendered < received ? (received - rendered) / received * 100 : 0,
      rtt: Math.round(networkDelay() + overload * 30),
      rttv: Math.round(network.jitter + overload * 10),
      host: hostLatency,
      hostMin: hostLatency - 1,
      hostMax: hostLatency + 3,
      queue: 0.6 + Math.random() * 0.4,
      pace: config.framePacing ? 0.3 : 0,
      sub: 0.2 + Math.random() * 0.2,
      poor: lossPercent > 5 ? 1 : 0,
      aDrop: 0,
      aErr: 0,
      idr: lossPercent > 10 ? 1 : 0,
      vErr: stream.frozen && elapsed > 1 ? 12 : 0,
      pos: stream.position || 0,
      lat: config.latencyMode ? 1 : 0,
    };
    global.handleMessage('StatsJson: ' + JSON.stringify(stats));
    if (stats.poor && !stream.warned) {
      stream.warned = true;
      global.handleMessage('WarningMsg: Slow connection to PC.\nReduce your bitrate!');
    }
  }

  function showFakeGameFrame(config) {
    var video = document.getElementById('wasm_module');
    if (!video) {
      return;
    }
    var canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    var context = canvas.getContext('2d');
    var sky = context.createLinearGradient(0, 0, 0, 540);
    sky.addColorStop(0, '#1b2a4a');
    sky.addColorStop(0.6, '#c0617a');
    sky.addColorStop(1, '#2b1d3a');
    context.fillStyle = sky;
    context.fillRect(0, 0, 960, 540);
    context.fillStyle = '#ffd27d';
    context.beginPath();
    context.arc(700, 300, 70, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#141024';
    context.beginPath();
    context.moveTo(0, 540);
    for (var x = 0; x <= 960; x += 40) {
      context.lineTo(x, 380 - Math.abs(Math.sin(x / 90)) * 120);
    }
    context.lineTo(960, 540);
    context.fill();
    context.fillStyle = 'rgba(255, 255, 255, 0.85)';
    context.font = '22px Roboto, sans-serif';
    context.fillText('Simulated stream ' + config.width + 'x' + config.height + ' @ ' + config.fps + ' FPS', 24, 40);
    video.setAttribute('poster', canvas.toDataURL('image/png'));
  }

  function endSession(errorCode) {
    var stream = session;
    session = null;
    if (stream && stream.timer) {
      clearInterval(stream.timer);
    }
    global.handleMessage('streamTerminated: ' + errorCode);
    post('StreamCleanupDone', 300);
  }

  // Module API -------------------------------------------------------------------------------------

  var resolved = function(value) {
    return { type: 'resolve', ret: value === undefined ? null : value };
  };

  Object.assign(global.Module, {
    makeCert: function() {
      return resolved({ cert: '-----BEGIN CERTIFICATE-----\nHARNESS\n-----END CERTIFICATE-----\n', privateKey: '-----BEGIN PRIVATE KEY-----\nHARNESS\n-----END PRIVATE KEY-----\n' });
    },
    httpInit: function() {
      return resolved();
    },
    openUrl: function(callbackId, url, ppk, binary) {
      if (!isFakeHost(url)) {
        answer(callbackId, 'reject', '-1', 20);
        return;
      }
      var path = url.replace(/^https?:\/\/[^\/]+/, '');
      if (path.indexOf('/serverinfo') === 0) {
        answer(callbackId, 'resolve', serverInfoXml());
      } else if (path.indexOf('/applist') === 0) {
        answer(callbackId, 'resolve', appListXml(), 60);
      } else if (path.indexOf('/appasset') === 0) {
        var appId = parseInt(/appid=(\d+)/.exec(path)[1], 10);
        boxArtBytes(appId).then(function(bytes) {
          answer(callbackId, 'resolve', bytes, 30 + Math.random() * 120);
        });
      } else if (path.indexOf('/launch') === 0 || path.indexOf('/resume') === 0) {
        var launchedId = /appid=(\d+)/.exec(path);
        if (launchedId) {
          fakeHost.currentGame = parseInt(launchedId[1], 10);
        }
        answer(callbackId, 'resolve', '<root status_code="200"><sessionUrl0>rtsp://192.168.1.50:48010</sessionUrl0><gamesession>1</gamesession></root>', 600);
      } else if (path.indexOf('/cancel') === 0) {
        fakeHost.currentGame = 0;
        answer(callbackId, 'resolve', '<root status_code="200"><cancel>1</cancel></root>', 300);
      } else if (path.indexOf('/pair') === 0) {
        answer(callbackId, 'resolve', '<root status_code="200"><paired>1</paired></root>');
      } else {
        answer(callbackId, 'reject', '-1');
      }
    },
    stun: function(callbackId) {
      answer(callbackId, 'resolve', '203.0.113.7', 50);
    },
    pair: function(callbackId) {
      // Pretend the user typed the PIN on the host after a moment
      later(1500, function() {
        fakeHost.paired = true;
        global.handlePromiseMessage(callbackId, 'resolve', 'HARNESS-PINNED-PUBLIC-KEY');
      });
    },
    wakeOnLan: function(callbackId, macAddress) {
      answer(callbackId, 'resolve', 'Magic packet sent successfully to MAC address: ' + macAddress, 20);
    },
    cancelRequest: function() {
      return resolved();
    },
    startStream: function(host, httpPort, width, height, fps, bitrate) {
      if (session) {
        return { type: 'reject', ret: 'stream-running' };
      }
      var args = Array.prototype.slice.call(arguments);
      var config = {
        width: parseInt(width, 10),
        height: parseInt(height, 10),
        fps: parseInt(fps, 10),
        bitrate: parseInt(bitrate, 10),
        framePacing: !!args[12],
        codec: args[23],
        hdr: !!args[24],
        latencyMode: args[26],
      };
      log('startStream ' + JSON.stringify(config));
      startSession(config);
      return resolved();
    },
    stopStream: function() {
      endSession(0);
      return resolved();
    },
    toggleStats: function() {
      post('StatsToggle');
    },
    sendKeyboardEvent: function() {},
    getPlatformCapabilities: function() {
      return { known: true, ultraLowLatency: params.get('ultraLow') !== '0' && parseFloat(params.get('platform') || '6.5') >= 6.0 };
    },
  });

  // The harness answers the HTTP reachability checks of the user interface for the fake host, and
  // fails every other address of the local network quickly, like a network without other hosts
  var nativeFetch = global.fetch.bind(global);
  global.fetch = function(resource, options) {
    var url = typeof resource === 'string' ? resource : resource.url;
    if (/^https?:\/\//.test(url) && url.indexOf(global.location.host) === -1) {
      if (isFakeHost(url)) {
        return new Promise(function(resolve) {
          later(networkDelay(), function() {
            resolve(new Response(serverInfoXml(), { status: 200, headers: { 'Content-Type': 'application/xml' } }));
          });
        });
      }
      if (/api\.github\.com/.test(url)) {
        return Promise.reject(new TypeError('Offline in the harness'));
      }
      return new Promise(function(resolve, reject) {
        later(5, function() { reject(new TypeError('Failed to fetch')); });
      });
    }
    return nativeFetch(resource, options);
  };

  // Seeds the storage of the application with a paired host, so the harness opens on a usable host
  function seedStorage() {
    return new Promise(function(resolve) {
      if (!fakeHost.paired) {
        resolve();
        return;
      }
      var request = indexedDB.open('GameStreamingDB', 1);
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains('GameStreamingStore')) {
          db.createObjectStore('GameStreamingStore');
        }
      };
      request.onerror = function() { resolve(); };
      request.onsuccess = function() {
        var db = request.result;
        var read = db.transaction('GameStreamingStore', 'readonly').objectStore('GameStreamingStore').get('hosts');
        read.onsuccess = function() {
          if (read.result) {
            db.close();
            resolve();
            return;
          }
          var transaction = db.transaction('GameStreamingStore', 'readwrite');
          var store = transaction.objectStore('GameStreamingStore');
          var hosts = {};
          hosts[fakeHost.uniqueid] = {
            hostname: fakeHost.hostname,
            address: fakeHost.address,
            userEnteredAddress: fakeHost.address,
            localAddress: fakeHost.address,
            macAddress: fakeHost.mac,
            httpsPort: 47984,
            httpPort: 47989,
            externalPort: 47989,
            serverUid: fakeHost.uniqueid,
            ppkstr: 'HARNESS-PINNED-PUBLIC-KEY',
            paired: true,
            autoWolEnabled: false,
          };
          store.put(JSON.stringify(hosts), 'hosts');
          store.put(JSON.stringify('0123456789abcdef'), 'uniqueid');
          transaction.oncomplete = function() {
            db.close();
            resolve();
          };
          transaction.onerror = function() { resolve(); };
        };
        read.onerror = function() { resolve(); };
      };
    });
  }

  seedStorage().then(function() {
    log('Simulated WASM runtime ready');
    global.Module.onRuntimeInitialized();
  });

  global.__harness = {
    host: fakeHost,
    network: network,
    endSession: endSession,
    session: function() { return session; },
  };
})(window);
