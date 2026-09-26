// Development harness: stand-ins for the Tizen Web Device API and the Samsung Product API.
//
// The harness runs the VibeLight user interface in a desktop browser. This file provides the small
// part of the `tizen` and `webapis` objects the application uses, with the TV properties taken from
// the query string of the page:
//
//   ?platform=6.5    Tizen version reported by tizen.systeminfo (default 6.5)
//   &edition=gamemode  The installed package is the Game Mode edition (its metadata asks for Game Mode)
//   &panel=4k        Panel of the TV: fhd, 4k or 8k (default 4k)
//   &hdr=1           Whether the TV reports HDR support (default 1)
//   &network=wifi    Active connection: ethernet or wifi (default wifi)
//   &signal=0.8      Wi-Fi signal strength between 0 and 1 (default 0.8)
//
// Nothing here is shipped with the widget.
(function(global) {
  'use strict';

  var params = new URLSearchParams(global.location.search);
  var platformVersion = params.get('platform') || '6.5';
  var panel = params.get('panel') || '4k';
  var hdr = params.get('hdr') !== '0';
  var network = params.get('network') || 'wifi';
  var signal = parseFloat(params.get('signal') || '0.8');

  function asyncCall(callback, value) {
    if (typeof callback === 'function') {
      setTimeout(function() { callback(value); }, 0);
    }
  }

  function notFound(path) {
    var error = new Error('File not found: ' + path);
    error.name = 'NotFoundError';
    return error;
  }

  var appInfo = {
    id: 'VibeLightT.VibeLight',
    name: 'VibeLight',
    packageId: 'VibeLightT',
    version: params.get('version') || '2.0.0',
  };

  global.tizen = {
    application: {
      getAppInfo: function() { return appInfo; },
      getCurrentApplication: function() {
        return {
          appInfo: appInfo,
          exit: function() { console.log('[harness] tizen.application exit()'); },
          getRequestedAppControl: function() { return null; },
        };
      },
      getAppMetaData: function() {
        return params.get('edition') === 'gamemode' ? [{ key: 'http://samsung.com/tv/metadata/use.game.mode', value: 'true' }] : [];
      },
      launchAppControl: function(appControl, id, onSuccess, onError) {
        asyncCall(onError, { name: 'NotFoundError', message: 'No background service in the harness' });
      },
    },
    ApplicationControl: function(operation, uri, mime, category, data) {
      this.operation = operation;
      this.uri = uri;
      this.mime = mime;
      this.category = category;
      this.data = data || [];
    },
    ApplicationControlData: function(key, value) {
      this.key = key;
      this.value = value;
    },
    systeminfo: {
      getCapability: function(key) {
        if (key === 'http://tizen.org/feature/platform.version') {
          return platformVersion;
        }
        return null;
      },
      getPropertyValue: function(property, onSuccess, onError) {
        switch (property) {
          case 'LOCALE':
            asyncCall(onSuccess, { language: (params.get('locale') || 'en_US'), country: '' });
            break;
          case 'NETWORK':
            asyncCall(onSuccess, { networkType: network === 'ethernet' ? 'ETHERNET' : 'WIFI' });
            break;
          case 'WIFI_NETWORK':
            asyncCall(onSuccess, {
              status: network === 'wifi' ? 'ON' : 'OFF',
              ssid: 'HomeNetwork',
              ipAddress: '192.168.1.20',
              signalStrength: network === 'wifi' ? signal : 0,
            });
            break;
          case 'ETHERNET_NETWORK':
            asyncCall(onSuccess, { cable: network === 'ethernet' ? 'ATTACHED' : 'DETACHED', status: network === 'ethernet' ? 'ENABLED' : 'DISABLED' });
            break;
          default:
            asyncCall(onError, { name: 'NotSupportedError', message: property + ' is not available in the harness' });
        }
      },
    },
    // In-memory file system for the box art cache of the application
    filesystem: {
      _files: {},
      openFile: function(path, mode) {
        var files = this._files;
        if (mode === 'r' && !files[path]) {
          throw notFound(path);
        }
        return {
          writeData: function(data) { files[path] = new Blob([data]); },
          readBlob: function() { return files[path]; },
          close: function() {},
        };
      },
      createDirectory: function() {},
      deleteDirectory: function(path) {
        var files = this._files;
        Object.keys(files).forEach(function(name) {
          if (name.indexOf(path + '/') === 0) {
            delete files[name];
          }
        });
      },
      deleteFile: function(path) { delete this._files[path]; },
      listDirectory: function(path, onSuccess) {
        var names = Object.keys(this._files).filter(function(name) {
          return name.indexOf(path + '/') === 0;
        }).map(function(name) {
          return name.substring(path.length + 1);
        });
        asyncCall(onSuccess, names);
      },
      toURI: function(path) { return 'file:///opt/usr/home/owner/content/' + path; },
    },
    tvinputdevice: {
      registerKey: function() {},
      unregisterKey: function() {},
    },
    tvaudiocontrol: {
      _muted: false,
      setVolumeUp: function() {},
      setVolumeDown: function() {},
      setMute: function(muted) { this._muted = !!muted; },
      isMute: function() { return this._muted; },
    },
    messageport: {
      requestLocalMessagePort: function() {
        return {
          addMessagePortListener: function() { return 1; },
          removeMessagePortListener: function() {},
        };
      },
      requestRemoteMessagePort: function() {
        return { sendMessage: function() {} };
      },
    },
  };

  global.webapis = {
    productinfo: {
      getModel: function() { return 'QE55Q80C'; },
      getRealModel: function() { return 'QE55Q80CAT'; },
      getModelCode: function() { return '23_PONTUSM_QTV'; },
      isUdPanelSupported: function() { return panel === '4k' || panel === '8k'; },
      is8KPanelSupported: function() { return panel === '8k'; },
    },
    avinfo: {
      isHdrTvSupport: function() { return hdr; },
    },
    network: {
      getIp: function() { return '192.168.1.20'; },
      getActiveConnectionType: function() { return network === 'ethernet' ? 3 : 1; },
      getWiFiSignalStrengthLevel: function() { return Math.round(signal * 5); },
    },
  };

  // Media capabilities of the TV, used to find out which codecs its decoder supports
  var supportedTypes = (params.get('codecs') || 'avc1,hev1.1,hev1.2,av01.0.13M.08,av01.0.13M.10').split(',');
  if (global.MediaSource) {
    var nativeIsTypeSupported = global.MediaSource.isTypeSupported;
    global.MediaSource.isTypeSupported = function(type) {
      for (var i = 0; i < supportedTypes.length; i++) {
        if (type.indexOf(supportedTypes[i]) !== -1) {
          return true;
        }
      }
      return /avc1/.test(type) ? nativeIsTypeSupported.call(global.MediaSource, type) : false;
    };
  }
})(window);
