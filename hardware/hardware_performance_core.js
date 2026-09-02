(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HPM = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Tomás's current hardware routing: MC tracks 1, 3 and 4 address the TR-8S on MIDI CH8.
  var MC_TRACK_MIDI_CHANNELS = { 1: 8, 2: 2, 3: 8, 4: 8, 5: 5, 6: 6, 7: 7, 8: 9 };
  var MC_TRACK_DESTINATIONS = { 1: 'tr8s', 2: 'mc707', 3: 'tr8s', 4: 'tr8s', 5: 'mc707', 6: 'mc707', 7: 'mc707', 8: 'mc707' };
  // The essential Roland-style palette for direct hardware controls.
  var ROLAND_COLORS = [
    ['#FF4F4F', 'Red'], ['#FF8A2A', 'Orange'], ['#4F8DFF', 'Blue'],
    ['#34F06E', 'Green'], ['#B584FF', 'Purple'], ['#FF63C5', 'Pink'], ['#F4F7FB', 'White']
  ];
  // LA PALETA DE SECCION, en hexadecimal. Es la misma de ArrangeLab y en el mismo orden.
  // Vive en el core y no en la pagina porque el color se GUARDA en la seccion: si fuera
  // una variable CSS, al mover una seccion el color se quedaria en la posicion en vez de
  // viajar con ella, que es justo lo que no tiene que pasar.
  var SECTION_PALETTE = [
    '#ff8a2a', '#ffd84a', '#34f06e', '#4f8dff', '#b584ff', '#ff63c5',
    '#f4f7fb', '#56e6ff', '#f6f1a4', '#a8d9ff', '#ffb4df', '#a8f1bf'
  ];

  // EL CATALOGO DE ESTRUCTURAS, el mismo de ArrangeLab. Tres escritas a mano y diez
  // medidas sobre 690 tracks de techno anotados a mano -el dataset Raveform-, donde
  // `tracks` es cuantos tracks reales usan esa forma. Lo que se copia es la SECUENCIA de
  // secciones, que es lo que se repite; los largos son los tipicos.
  //
  // Los nombres van resueltos: esta pagina no tiene i18n y es en español.
  var ESTRUCTURAS_BASE = [
    ['A', 'base', 'A — techno 128', 0,
      [['INTRO', 16], ['DESARROLLO', 16], ['BREAK', 16], ['BUILD', 16], ['DROP', 32], ['BAJADA', 16], ['OUTRO', 16]]],
    ['B', 'base', 'B — bajada larga 160', 0,
      [['INTRO', 16], ['DESARROLLO', 16], ['BREAK', 16], ['BUILD', 16], ['DROP', 32], ['BAJADA', 32], ['OUTRO', 32]]],
    ['C', 'base', 'C — DJ-friendly 224', 0,
      [['INTRO', 32], ['DESARROLLO 1', 32], ['DESARROLLO 2', 32], ['BREAK', 32], ['BUILD', 16],
       ['CLIMAX', 48], ['BAJADA', 16], ['OUTRO', 16]]],
    ['T1', 'techno', 'Corta antes del primer drop', 37,
      [['INTRO', 24], ['BUILD', 16], ['BREAK', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BAJADA', 16], ['OUTRO', 16]]],
    ['T2', 'techno', 'Dos drops, un break grande', 30,
      [['INTRO', 24], ['BUILD', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BAJADA', 16], ['OUTRO', 16]]],
    ['T3', 'techno', 'Dos drops, corta y directa', 29,
      [['INTRO', 24], ['BUILD', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['OUTRO', 16]]],
    ['T4', 'techno', 'Tres drops, sin build', 26,
      [['INTRO', 24], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BREAK', 16], ['DROP', 32], ['OUTRO', 16]]],
    ['T5', 'techno', 'Tres drops', 23,
      [['INTRO', 24], ['BUILD', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BREAK', 16], ['DROP', 32], ['OUTRO', 16]]],
    ['T6', 'techno', 'Tres drops, cierra bajando', 23,
      [['INTRO', 24], ['BUILD', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BREAK', 16], ['DROP', 32], ['BAJADA', 16], ['OUTRO', 16]]],
    ['T7', 'techno', 'Tres breaks y tres drops', 23,
      [['INTRO', 24], ['BUILD', 16], ['BREAK', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BREAK', 16], ['DROP', 32], ['BAJADA', 16], ['OUTRO', 16]]],
    ['T8', 'techno', 'Break primero, dos drops', 22,
      [['INTRO', 24], ['BUILD', 16], ['BREAK', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['OUTRO', 16]]],
    ['T9', 'techno', 'Dos bajadas', 20,
      [['INTRO', 24], ['BUILD', 16], ['BREAK', 16], ['DROP', 32], ['BAJADA', 16], ['BREAK', 32], ['DROP', 32], ['BAJADA', 16], ['OUTRO', 16]]],
    ['T10', 'techno', 'Cierra por el break', 16,
      [['INTRO', 24], ['BUILD', 16], ['BREAK', 16], ['DROP', 32], ['BREAK', 32], ['DROP', 32], ['BREAK', 16], ['BAJADA', 16], ['OUTRO', 16]]]
  ];

  function structureCatalog() {
    return ESTRUCTURAS_BASE.map(function (e) {
      return {
        id: e[0], grupo: e[1], nombre: e[2], tracks: e[3],
        sections: e[4].map(function (s) { return { name: s[0], bars: s[1] }; }),
        bars: e[4].reduce(function (a, s) { return a + s[1]; }, 0)
      };
    });
  }

  var CC_CATALOGS = {
    mc707: [[1,'Modulation'],[5,'Portamento Time'],[7,'Volume'],[10,'Pan'],[11,'Expression'],[64,'Hold'],[65,'Portamento'],[66,'Sostenuto'],[67,'Soft'],[68,'Legato'],[71,'Resonance'],[72,'Release'],[73,'Attack'],[74,'Cutoff'],[75,'Decay'],[76,'Vibrato Rate'],[77,'Vibrato Depth'],[78,'Vibrato Delay'],[80,'Filter Knob'],[81,'Mod Knob'],[82,'FX Knob'],[83,'Sound Knob'],[91,'Reverb Send'],[92,'Chorus Send']],
    tr8s: [[9,'Shuffle'],[12,'External In Level'],[14,'Auto Fill In'],[15,'Master FX On'],[16,'Delay Level'],[17,'Delay Time'],[18,'Delay Feedback'],[19,'Master FX Ctrl'],[20,'BD Tune'],[23,'BD Decay'],[24,'BD Level'],[25,'SD Tune'],[28,'SD Decay'],[29,'SD Level'],[46,'LT Tune'],[47,'LT Decay'],[48,'LT Level'],[49,'MT Tune'],[50,'MT Decay'],[51,'MT Level'],[52,'HT Tune'],[53,'HT Decay'],[54,'HT Level'],[55,'RS Tune'],[56,'RS Decay'],[57,'RS Level'],[58,'HC Tune'],[59,'HC Decay'],[60,'HC Level'],[61,'CH Tune'],[62,'CH Decay'],[63,'CH Level'],[70,'Auto Fill Trigger'],[71,'Accent'],[80,'OH Tune'],[81,'OH Decay'],[82,'OH Level'],[83,'CC Tune'],[84,'CC Decay'],[85,'CC Level'],[86,'RC Tune'],[87,'RC Decay'],[88,'RC Level'],[91,'Reverb Level'],[96,'BD Ctrl'],[97,'SD Ctrl'],[102,'LT Ctrl'],[103,'MT Ctrl'],[104,'HT Ctrl'],[105,'RS Ctrl'],[106,'HC Ctrl'],[107,'CH Ctrl'],[108,'OH Ctrl'],[109,'CC Ctrl'],[110,'RC Ctrl']]
  };
  var DEFAULT_STEMS = [
    ['kick-tom','Kick + Low Tom',8,'tr8s',[['bd',24,'Kick'],['lt',48,'Low Tom']]],
    ['bass','Bass',2,'mc707',[['volume',7,'Volume']]],
    ['drums','Drums',8,'tr8s',[['sd',29,'Snare'],['mt',51,'Mid Tom'],['ht',54,'High Perc'],['rs',57,'Rim / Shaker'],['hc',60,'Clap'],['ch',63,'Closed Hat'],['oh',82,'Offbeat Hat'],['ride',85,'Ride'],['crash',88,'Crash']]],
    ['acid','Acid',5,'mc707',[['volume',7,'Volume'],['cutoff',74,'Cutoff']]],
    ['lead','Lead',6,'mc707',[['volume',7,'Volume'],['cutoff',74,'Cutoff']]],
    ['synth-1','Synth 1',7,'mc707',[['volume',7,'Volume'],['cutoff',74,'Cutoff']]],
    ['synth-2','Synth 2',9,'mc707',[['volume',7,'Volume'],['cutoff',74,'Cutoff']]]
  ];
  var TR8S_INSTRUMENTS = [
    ['bd', 'BD', 24, 20, 23, 96], ['lt', 'LT', 48, 46, 47, 102], ['sd', 'SD', 29, 25, 28, 97],
    ['mt', 'MT', 51, 49, 50, 103], ['ht', 'HT', 54, 52, 53, 104], ['rs', 'RS', 57, 55, 56, 105],
    ['hc', 'HC', 60, 58, 59, 106], ['ch', 'CH', 63, 61, 62, 107], ['oh', 'OH', 82, 80, 81, 108],
    ['cc', 'CC', 85, 83, 84, 109], ['rc', 'RC', 88, 86, 87, 110]
  ];
  var MC_SYNTHS = [
    ['mc2', 'MC 2 · Bass', 2], ['mc5', 'MC 5 · Acid', 5], ['mc6', 'MC 6 · Lead', 6],
    ['mc7', 'MC 7 · Synth 1', 7], ['mc8', 'MC 8 · Synth 2', 9]
  ];
  var DEVICE_GROUPS = { lowend: 'LOW END', kick: 'KICK', drums: 'DRUMS' };
  var REALTIME_CONTROLS = [];
  TR8S_INSTRUMENTS.forEach(function (instrument) {
    var id = instrument[0];
    var label = 'TR-8S · ' + instrument[1];
    REALTIME_CONTROLS.push(
      { id:'tr8s-' + id + '-level', label:label, name:'Level', destination:'MIDI CH8 · CC' + instrument[2], targets:[[8, instrument[2]]] },
      { id:'tr8s-' + id + '-tune', label:label, name:'Tune', destination:'MIDI CH8 · CC' + instrument[3], targets:[[8, instrument[3]]], min:-128, max:127 },
      { id:'tr8s-' + id + '-decay', label:label, name:'Decay', destination:'MIDI CH8 · CC' + instrument[4], targets:[[8, instrument[4]]] },
      { id:'tr8s-' + id + '-ctrl', label:label, name:'Ctrl', destination:'MIDI CH8 · CC' + instrument[5], targets:[[8, instrument[5]]] }
    );
  });
  // FX globales de la TR-8S. Son perillas, aunque dos se llamen Level: no participan de
  // MUTE ALL ni de SOLO, que operan exclusivamente sobre faders de instrumentos.
  REALTIME_CONTROLS.push(
    { id:'tr8s-delay-level', label:'TR-8S · Delay', name:'Level', globalLabel:'Delay Level', destination:'MIDI CH8 · CC16', targets:[[8,16]], controlType:'knob', global:true },
    { id:'tr8s-delay-feedback', label:'TR-8S · Delay', name:'Feedback', globalLabel:'Delay Feedback', destination:'MIDI CH8 · CC18', targets:[[8,18]], global:true },
    { id:'tr8s-master-fx-ctrl', label:'TR-8S · Master FX', name:'Ctrl', globalLabel:'Master FX Ctrl', destination:'MIDI CH8 · CC19', targets:[[8,19]], global:true },
    { id:'tr8s-reverb-level', label:'TR-8S · Reverb', name:'Level', globalLabel:'Reverb Level', destination:'MIDI CH8 · CC91', targets:[[8,91]], controlType:'knob', global:true }
  );
  // MC track 4 is the recorded drums return. It is a DRUMS-group master, not a TR-8S instrument level.
  REALTIME_CONTROLS.push({ id:'mc4-drums-level', label:'MC 4 · Drums Master', name:'Level', destination:'MC-707 · MIDI CH8 · CC7', targets:[[8,7]], hidden:true });
  MC_SYNTHS.forEach(function (synth) {
    REALTIME_CONTROLS.push(
      { id:synth[0] + '-level', label:synth[1], name:'Level', destination:'MC-707 · MIDI CH' + synth[2], targets:[[synth[2],7]] },
      { id:synth[0] + '-filter', label:synth[1], name:'Filter', destination:'MC-707 · MIDI CH' + synth[2], targets:[[synth[2],80]] },
      { id:synth[0] + '-mod', label:synth[1], name:'Mod', destination:'MC-707 · MIDI CH' + synth[2], targets:[[synth[2],81]] },
      { id:synth[0] + '-fx', label:synth[1], name:'FX', destination:'MC-707 · MIDI CH' + synth[2], targets:[[synth[2],82]] },
      { id:synth[0] + '-sound', label:synth[1], name:'Sound', destination:'MC-707 · MIDI CH' + synth[2], targets:[[synth[2],83]] }
    );
  });

  function controlRegistry() {
    return REALTIME_CONTROLS.map(function (control) {
      var registered = clone(control);
      var isTr8s = control.id.indexOf('tr8s-') === 0;
      registered.logicalDestination = isTr8s ? 'TR-8S · ' + control.destination : control.destination;
      registered.physicalOutput = 'MC-707 USB MIDI OUT';
      registered.controlType = control.controlType || (control.name === 'Level' ? 'fader' : 'knob');
      registered.min = Number.isFinite(control.min) ? control.min : 0;
      registered.max = Number.isFinite(control.max) ? control.max : 127;
      registered.deviceId = control.id.replace(/-(level|tune|decay|ctrl|filter|mod|fx|sound|feedback)$/, '');
      registered.deviceLabel = control.label;
      registered.renamable = control.name === 'Ctrl';
      return registered;
    });
  }

  var DEFAULT_PROJECT = {
    schemaVersion: 3,
    bpm: 138,
    totalBars: 64,
    controlChannel: 16,
    midiOutputId: '',
    timeSignature: { numerator: 4, denominator: 4 },
    // La estructura del Set: null hasta que se cargue un .als con locators.
    structure: null,
    programChanges: [],
    automationLanes: [],
    liveControls: { order: [], labels: {}, colors: {}, groups: [], linkedDeviceGroups: [], soloSafeDeviceIds: [], ranges: {}, deviceChannel: {} },
    performanceStems: []
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = fallback;
    n = Math.round(n);
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function sortByBar(a, b) {
    return a.bar - b.bar;
  }

  // UN PUNTO NO CAE SOLO EN EL BORDE DEL COMPAS. Con zoom se dibuja en medio compas, en
  // un cuarto o en un step, asi que el compas es fraccionario. Se redondea a 1/64 de
  // compas -mas fino que un step de 1/16- para que dos puntos dibujados en el mismo lugar
  // den el mismo numero y el escalon funcione.
  var PASO_MINIMO = 1 / 64;

  function normalizeBar(bar) {
    var b = Number(bar);
    if (!Number.isFinite(b)) b = 1;
    b = Math.round(b / PASO_MINIMO) * PASO_MINIMO;
    return Math.max(1, Math.min(9999, Math.round(b * 1e6) / 1e6));
  }

  function normalizePoint(point) {
    return {
      bar: normalizeBar(point && point.bar),
      value: clampInt(point && point.value, 0, 127, 0)
    };
  }

  function normalizeProgramChange(item) {
    return {
      bar: Math.max(8, Math.round(clampInt(item && item.bar, 8, 9999, 8) / 8) * 8),
      program: clampInt(item && item.program, 0, 127, 0)
    };
  }

  // UNA LANE SE DIRECCIONA POR SU CONTROL, no por numero MIDI.
  //
  // Antes habia que saber que el cutoff del acid era MC track 5, CC 74, y elegirlo en dos
  // desplegables. Con controlId la lane dice "el Filter del Acid" y el canal y el CC salen
  // del registro. Las lanes viejas, que solo traen mcTrack y cc, se siguen leyendo igual.
  function laneControl(controlId) {
    if (!controlId) return null;
    var controls = controlRegistry();
    for (var i = 0; i < controls.length; i++) if (controls[i].id === controlId) return controls[i];
    return null;
  }

  function mcTrackForChannel(channel, fallback) {
    for (var track in MC_TRACK_MIDI_CHANNELS)
      if (MC_TRACK_MIDI_CHANNELS[track] === channel) return Number(track);
    return fallback;
  }

  function normalizeLane(lane, index, liveControls) {
    var safe = lane || {};
    var points = Array.isArray(safe.points) ? safe.points.map(normalizePoint).sort(sortByBar) : [];
    var control = laneControl(safe.controlId);
    if (control) {
      var rango = controlRange(control.id, liveControls);
      points = points.map(function (p) {
        return { bar: p.bar, value: clampInt(p.value, rango.min, rango.max, rango.min) };
      });
    }
    if (control) {
      var channel = control.targets[0][0];
      var track = mcTrackForChannel(channel, 5);
      // EL NOMBRE ES EL QUE PUSO TOMAS. Si renombro el canal a "ACID2", la lane se llama
      // "ACID2 · Filter" y no "MC 6 · Lead": el nombre de fabrica no le dice nada a nadie.
      // Se recalcula siempre, salvo que la lane tenga un nombre escrito a mano.
      var etiquetaDevice = (liveControls && liveControls.deviceLabels && liveControls.deviceLabels[control.deviceId]) ||
        control.deviceLabel;
      var etiquetaParam = (liveControls && liveControls.labels && liveControls.labels[control.id]) || control.name;
      return {
        id: safe.id || ('lane-' + control.id),
        customName: String(safe.customName || ''),
        name: safe.customName || (etiquetaDevice + ' · ' + etiquetaParam),
        // Plegada o no es del proyecto: en vivo se abre la que se esta dibujando y el
        // resto queda en una linea.
        collapsed: !!safe.collapsed,
        // APAGADA NO ES BORRADA. El dibujo queda, pero no manda un solo CC: sirve para
        // probar el tema sin esa automatizacion y volver a prenderla sin rehacerla.
        off: !!safe.off,
        controlId: control.id,
        mcTrack: track,
        channel: channel,
        destination: MC_TRACK_DESTINATIONS[track],
        cc: control.targets[0][1],
        points: dedupePoints(points)
      };
    }
    var mcTrack = clampInt(safe.mcTrack !== undefined ? safe.mcTrack : safe.channel, 1, 8, 5);
    return {
      id: safe.id || ('lane-' + (index + 1)),
      name: safe.name || ('Lane ' + (index + 1)),
      controlId: '',
      mcTrack: mcTrack,
      channel: MC_TRACK_MIDI_CHANNELS[mcTrack],
      destination: MC_TRACK_DESTINATIONS[mcTrack],
      cc: clampInt(safe.cc, 0, 127, 74),
      collapsed: !!safe.collapsed,
      off: !!safe.off,
      points: dedupePoints(points)
    };
  }

  function normalizeLiveControls(layout) {
    var raw = layout || {};
    var controls = controlRegistry();
    var ids = controls.map(function (control) { return control.id; });
    var seen = {};
    var order = (Array.isArray(raw.order) ? raw.order : []).filter(function (id) {
      if (ids.indexOf(id) < 0 || seen[id]) return false;
      seen[id] = true;
      return true;
    });
    ids.forEach(function (id) { if (!seen[id]) order.push(id); });
    var labels = {};
    Object.keys(raw.labels || {}).forEach(function (id) {
      var label = String(raw.labels[id] || '').trim().slice(0, 48);
      if (ids.indexOf(id) >= 0 && label) labels[id] = label;
    });
    var colors = {};
    Object.keys(raw.colors || {}).forEach(function (id) {
      var color = String(raw.colors[id] || '').trim();
      if (ids.indexOf(id) >= 0 && ROLAND_COLORS.some(function (entry) { return entry[0] === color.toUpperCase(); })) colors[id] = color.toUpperCase();
    });
    var devices = {};
    controls.forEach(function (control) {
      if (!devices[control.deviceId]) devices[control.deviceId] = { id: control.deviceId, label: control.deviceLabel, controlIds: [] };
      devices[control.deviceId].controlIds.push(control.id);
    });
    var deviceIds = Object.keys(devices);
    var linkedDeviceIds = {};
    var linkedDeviceGroups = (Array.isArray(raw.linkedDeviceGroups) ? raw.linkedDeviceGroups : []).map(function (group, index) {
      var deviceIdsInGroup = (Array.isArray(group && group.deviceIds) ? group.deviceIds : []).filter(function (deviceId) {
        if (deviceIds.indexOf(deviceId) < 0 || linkedDeviceIds[deviceId]) return false;
        linkedDeviceIds[deviceId] = true;
        return true;
      });
      return deviceIdsInGroup.length > 1 ? { id: String(group && group.id || 'link-' + index), deviceIds: deviceIdsInGroup } : null;
    }).filter(Boolean);
    var soloSafeDeviceIds = (Array.isArray(raw.soloSafeDeviceIds) ? raw.soloSafeDeviceIds : []).filter(function (deviceId, index, list) {
      return deviceIds.indexOf(deviceId) >= 0 && list.indexOf(deviceId) === index;
    });
    var deviceOrder = (Array.isArray(raw.deviceOrder) ? raw.deviceOrder : []).filter(function (id, index, list) {
      return deviceIds.indexOf(id) >= 0 && list.indexOf(id) === index;
    });
    order.forEach(function (id) {
      var deviceId = controls.filter(function (control) { return control.id === id; })[0].deviceId;
      if (deviceOrder.indexOf(deviceId) < 0) deviceOrder.push(deviceId);
    });
    var deviceLabels = {};
    var deviceColors = {};
    deviceIds.forEach(function (deviceId) {
      var device = devices[deviceId];
      var rawLabel = String((raw.deviceLabels || {})[deviceId] || '').trim().slice(0, 48);
      var legacyLabel = labels[device.controlIds[0]];
      if (rawLabel) deviceLabels[deviceId] = rawLabel;
      else if (legacyLabel) deviceLabels[deviceId] = legacyLabel;
      var rawColor = String((raw.deviceColors || {})[deviceId] || '').trim().toUpperCase();
      var legacyColor = colors[device.controlIds[0]];
      if (ROLAND_COLORS.some(function (entry) { return entry[0] === rawColor; })) deviceColors[deviceId] = rawColor;
      else if (legacyColor) deviceColors[deviceId] = legacyColor;
    });
    var groupedDeviceIds = {};
    var groups = (Array.isArray(raw.groups) ? raw.groups : []).map(function (group, index) {
      var id = String(group && group.id || '').trim();
      if (!DEVICE_GROUPS[id]) return null;
      var name = DEVICE_GROUPS[id];
      var deviceIdsInGroup = (Array.isArray(group && group.deviceIds) ? group.deviceIds : []).filter(function (deviceId) {
        if (deviceIds.indexOf(deviceId) < 0 || groupedDeviceIds[deviceId]) return false;
        groupedDeviceIds[deviceId] = true;
        return true;
      });
      return { id: id, name: name, deviceIds: deviceIdsInGroup, collapsed: !!(group && group.collapsed) };
    }).filter(function (group) { return group && group.deviceIds.length > 0; });
    // RANGO UTIL POR CONTROL. El recorrido de 0..127 casi nunca sirve entero: segun el
    // patch, el filtro del acid puede ser util solo entre 30 y 90, y afuera de ahi el
    // fader se mueve al pepe. El rango es POR CONTROL —no por device— porque el Level y
    // el Filter del mismo device no tienen por que compartirlo.
    //
    // El rango es una restriccion de la INTERFAZ sobre el limite duro del control: nunca
    // puede salirse de el (0..127, o -128..127 en el Tune), y min tiene que ser menor que
    // max o se descarta y vuelve el limite duro.
    var ranges = {};
    Object.keys(raw.ranges || {}).forEach(function (id) {
      var control = null;
      for (var i = 0; i < controls.length; i++) if (controls[i].id === id) control = controls[i];
      if (!control) return;
      var pedido = raw.ranges[id] || {};
      var min = clampInt(pedido.min, control.min, control.max, control.min);
      var max = clampInt(pedido.max, control.min, control.max, control.max);
      if (min >= max) return;
      if (min === control.min && max === control.max) return;
      ranges[id] = { min: min, max: max };
    });
    // QUE INSTRUMENTOS VAN A CADA CANAL DEL SET.
    //
    // Un device suena por UNA sola salida de la maquina, asi que la asignacion es de a uno:
    // device -> par USB (S1, S4...). El par es la llave y no el nombre del canal, porque el
    // nombre lo cambia Tomas y el par no.
    //
    // Esto NO se puede deducir del .als: el Set dice que entra por 9/10 se llama "HHs",
    // pero no cual de los once instrumentos de la TR-8S es. Lo dice Tomas una vez y se
    // guarda con el preset.
    var deviceChannel = {};
    Object.keys(raw.deviceChannel || {}).forEach(function (deviceId) {
      if (deviceIds.indexOf(deviceId) < 0) return;
      var key = String(raw.deviceChannel[deviceId] || '').trim();
      if (/^S\d+$/.test(key)) deviceChannel[deviceId] = key;
    });
    return { order: order, labels: labels, colors: colors, deviceOrder: deviceOrder, deviceLabels: deviceLabels, deviceColors: deviceColors, groups: groups, linkedDeviceGroups: linkedDeviceGroups, soloSafeDeviceIds: soloSafeDeviceIds, ranges: ranges, deviceChannel: deviceChannel };
  }

  function isLegacyDemoLane(lane) {
    if (!lane || (lane.id !== 'lane-volume-acid' && lane.id !== 'lane-cutoff-acid')) return false;
    var expected = lane.id === 'lane-volume-acid'
      ? [[1, 0], [9, 127], [25, 127], [33, 40]]
      : [[1, 40], [17, 40], [33, 80], [49, 127]];
    var points = lane.points || [];
    return points.length === expected.length && points.every(function (point, index) {
      return Number(point.bar) === expected[index][0] && Number(point.value) === expected[index][1];
    });
  }

  // DOS PUNTOS EN EL MISMO COMPAS SON UN ESCALON, no un error: el valor salta ahi mismo
  // en vez de subir en rampa. `interpolateLaneValue` ya lo resuelve -si los dos beats son
  // iguales devuelve el segundo-, asi que lo unico que hay que hacer es no borrarlos.
  // Tres si serian un error: el del medio no se puede ni ver ni tocar.
  function dedupePoints(points) {
    var out = [];
    for (var i = 0; i < points.length; i += 1) {
      var enEseCompas = 0;
      for (var j = out.length - 1; j >= 0 && out[j].bar === points[i].bar; j -= 1) enEseCompas += 1;
      if (enEseCompas >= 2) out[out.length - 1] = points[i];
      else out.push(points[i]);
    }
    return out;
  }

  function dedupeBars(items) {
    var out = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (out.length && out[out.length - 1].bar === item.bar) out[out.length - 1] = item;
      else out.push(item);
    }
    return out;
  }

  function beatsPerBar(project) {
    var ts = project && project.timeSignature ? project.timeSignature : {};
    return clampInt(ts.numerator, 1, 32, 4);
  }

  // Sin redondear: un punto puede estar en el compas 9.5 y el beat tiene que caer ahi.
  function barToBeat(project, bar) {
    return (normalizeBar(bar) - 1) * beatsPerBar(project);
  }

  function beatToBarFloat(project, beat) {
    return (beat / beatsPerBar(project)) + 1;
  }

  function normalizeProject(project) {
    var raw = project || {};
    var rawLanes = Array.isArray(raw.automationLanes) ? raw.automationLanes : [];
    // The first builds stored two demo lanes that moved the acid as soon as Play ran.
    // Drop them only when still intact, never when the user has edited them.
    if (!raw.schemaVersion) rawLanes = rawLanes.filter(function (lane) { return !isLegacyDemoLane(lane); });
    var safe = {
      schemaVersion: DEFAULT_PROJECT.schemaVersion,
      bpm: clampInt(raw.bpm, 20, 300, DEFAULT_PROJECT.bpm),
      totalBars: clampInt(raw.totalBars, 1, 9999, DEFAULT_PROJECT.totalBars),
      controlChannel: clampInt(raw.controlChannel, 1, 16, DEFAULT_PROJECT.controlChannel),
      midiOutputId: raw.midiOutputId || '',
      timeSignature: {
        numerator: clampInt(raw.timeSignature && raw.timeSignature.numerator, 1, 32, 4),
        denominator: clampInt(raw.timeSignature && raw.timeSignature.denominator, 1, 32, 4)
      },
      structure: normalizeStructure(raw.structure),
      programChanges: Array.isArray(raw.programChanges)
        ? dedupeBars(raw.programChanges.map(normalizeProgramChange).sort(sortByBar))
        : [],
      automationLanes: [],
      liveControls: normalizeLiveControls(raw.liveControls),
      // Performance Blocks are paused while the MVP focuses on direct live control.
      performanceStems: []
    };

    // Las lanes se normalizan DESPUES de liveControls porque necesitan el rango util de su
    // control: un punto dibujado fuera de los limites que se fijaron no puede quedar
    // guardado. Una lane vieja, sin controlId, se queda con el limite duro.
    safe.automationLanes = Array.isArray(raw.automationLanes)
      ? rawLanes.map(function (lane, i) { return normalizeLane(lane, i, safe.liveControls); })
      : [];

    // EL LARGO LO MANDA EL SET, SIEMPRE. Los compases son la suma de las secciones y no
    // un numero tipeado: es la consecuencia directa de traer los locators. Se redondea
    // para arriba porque un locator puede caer a mitad de compas y ese compas igual
    // existe.
    //
    // Y NADA LO PUEDE ESTIRAR. Un punto o una escena mas alla del ultimo locator se pega
    // al final en vez de agrandar la timeline: si el tema dura 152 compases, la pagina
    // dura 152 compases. Antes cualquier punto suelto corria el final y la pantalla
    // dejaba de coincidir con el Set.
    var barsFromStructure = Math.ceil(structureTotalBars(safe.structure));
    if (barsFromStructure > 0) {
      safe.totalBars = clampInt(barsFromStructure, 1, 9999, safe.totalBars);
      safe.programChanges = dedupeBars(safe.programChanges.map(function (pc) {
        return pc.bar > safe.totalBars ? { bar: safe.totalBars, program: pc.program } : pc;
      }).sort(sortByBar));
      safe.automationLanes.forEach(function (lane) {
        lane.points = dedupePoints(lane.points.map(function (point) {
          return point.bar > safe.totalBars ? { bar: safe.totalBars, value: point.value } : point;
        }).sort(sortByBar));
      });
      return safe;
    }

    // Sin estructura no hay largo propio: esto es solo para que un proyecto viejo no
    // pierda puntos. La pagina no deja tocar en este estado.
    if (safe.programChanges.length && safe.totalBars < safe.programChanges[safe.programChanges.length - 1].bar) {
      safe.totalBars = safe.programChanges[safe.programChanges.length - 1].bar;
    }

    for (var i = 0; i < safe.automationLanes.length; i += 1) {
      var lane = safe.automationLanes[i];
      if (lane.points.length && safe.totalBars < lane.points[lane.points.length - 1].bar) {
        safe.totalBars = lane.points[lane.points.length - 1].bar;
      }
    }
    return safe;
  }

  function getProjectEndBeat(project) {
    return Math.max(0, barToBeat(project, project.totalBars + 1));
  }

  function interpolateLaneValue(lane, beat, project) {
    if (!lane || !lane.points || !lane.points.length) return null;
    var points = lane.points;
    var firstBeat = barToBeat(project, points[0].bar);
    if (beat <= firstBeat) return points[0].value;

    // JUSTO ENCIMA DE UN PUNTO MANDA EL ULTIMO DE ESE COMPAS. Con un escalon -dos puntos
    // en el mismo compas- el valor nuevo tiene que entrar EN el compas, no un paso
    // despues: si no, un corte llega tarde.
    var exacto = null;
    for (var e = 0; e < points.length; e += 1) {
      if (barToBeat(project, points[e].bar) === beat) exacto = points[e];
    }
    if (exacto) return exacto.value;

    for (var i = 0; i < points.length - 1; i += 1) {
      var a = points[i];
      var b = points[i + 1];
      var beatA = barToBeat(project, a.bar);
      var beatB = barToBeat(project, b.bar);
      if (beat <= beatB) {
        if (beatB === beatA) return b.value;
        var t = (beat - beatA) / (beatB - beatA);
        return Math.round(a.value + (b.value - a.value) * t);
      }
    }
    return points[points.length - 1].value;
  }

  function buildAutomationEvents(project, options) {
    var safe = normalizeProject(project);
    var opts = options || {};
    var stepBeats = Number(opts.ccStepBeats);
    if (!Number.isFinite(stepBeats) || stepBeats <= 0) stepBeats = 0.25;
    var endBeat = getProjectEndBeat(safe);
    var events = [];

    safe.automationLanes.forEach(function (lane) {
      // APAGADA NO ES BORRADA: el dibujo queda pero no manda un solo CC.
      if (lane.off) return;
      if (!lane.points.length) return;
      var startBeat = barToBeat(safe, lane.points[0].bar);
      var lastValue = null;
      for (var beat = startBeat; beat <= endBeat + 0.0001; beat += stepBeats) {
        var value = interpolateLaneValue(lane, beat, safe);
        if (value === null) continue;
        if (lastValue === value && beat > startBeat) continue;
        lastValue = value;
        events.push({
          type: 'cc',
          beat: Number(beat.toFixed(6)),
          bar: beatToBarFloat(safe, beat),
          channel: lane.channel,
          cc: lane.cc,
          value: value,
          laneId: lane.id,
          laneName: lane.name
        });
      }
    });
    return events;
  }

  // EL ENGINE CC: de la matriz a eventos MIDI.
  //
  // Traduce lo pintado en el arrangement a CC, aplicando la tabla de prioridad de
  // HARDWARE_ARRANGEMENT_DESIGN.md §3. Solo se resuelven acá las tres capas que viven en
  // la timeline: lane > bloque > presencia. El control manual (prioridad 1) es de tiempo
  // real y no puede estar en un plan calculado de antemano.
  //
  // No manda nada por su cuenta: devuelve eventos. Quien los emite es el Scheduler.
  function controlTarget(deviceId, paramName) {
    var wanted = String(paramName || 'level').toLowerCase();
    var controls = controlRegistry();
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].deviceId === deviceId && controls[i].name.toLowerCase() === wanted)
        return { id: controls[i].id, channel: controls[i].targets[0][0], cc: controls[i].targets[0][1],
                 min: controls[i].min, max: controls[i].max };
    }
    return null;
  }

  // El rango util de un control: el que definio el usuario para este patch, o el limite
  // duro si no definio ninguno.
  function controlRange(controlId, liveControls) {
    var controls = controlRegistry();
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].id !== controlId) continue;
      var custom = liveControls && liveControls.ranges && liveControls.ranges[controlId];
      if (custom) return { min: custom.min, max: custom.max };
      return { min: controls[i].min, max: controls[i].max };
    }
    return { min: 0, max: 127 };
  }

  // Una lane MANDA sobre su CC entre su primer y su ultimo punto. Adentro de ese tramo el
  // bloque y la presencia no escriben: si escribieran, el salto discreto del borde de
  // seccion pisaria la curva que se dibujo a mano justo ahi.
  function laneOwns(lanes, channel, cc, beat, project) {
    for (var i = 0; i < lanes.length; i++) {
      var lane = lanes[i];
      if (!lane.points || !lane.points.length) continue;
      if (lane.channel !== channel || lane.cc !== cc) continue;
      var desde = barToBeat(project, lane.points[0].bar);
      var hasta = barToBeat(project, lane.points[lane.points.length - 1].bar);
      if (beat >= desde - 1e-9 && beat <= hasta + 1e-9) return true;
    }
    return false;
  }

  // CUANDO DISPARA UN BLOQUE.
  //
  // Un trigger no necesariamente cae en el borde de la seccion: puede esperar a la grilla
  // de 8 compases, o de 4. La razon es musical: los patrones de la MC-707 y la TR-8S
  // corren en frases de 4 y 8, y un CC que entra a mitad de frase entra mal.
  //
  // LA GRILLA ES ABSOLUTA, contada desde el compas 1 del arreglo, no desde el principio de
  // la seccion. Si fuera relativa, una seccion de largo raro —el .als de Tomas tiene un
  // BUILD de 15 y un FILL de 1— correria la grilla de ahi en adelante y los disparos
  // dejarian de caer con las frases de la maquina.
  //
  // repeat=false dispara UNA vez, en el primer punto de grilla de la seccion. repeat=true
  // dispara en cada punto de grilla que caiga adentro. Con grid=0 es el borde de la
  // seccion, que es el comportamiento de siempre.
  //
  // Ojo con el caso sin disparo: si la seccion es corta y no contiene ningun punto de
  // grilla, el bloque NO suena. Es correcto —no hay donde entrar en frase— pero hay que
  // verlo en la interfaz, no descubrirlo tocando.
  function triggerBeats(block, sectionStart, sectionEnd, bpb) {
    var grid = Number(block && block.grid) || 0;
    if (!(grid > 0)) return [sectionStart];
    var paso = grid * bpb;
    var primero = Math.ceil((sectionStart - 1e-9) / paso) * paso;
    // Math.ceil devuelve -0 cuando la seccion arranca en 0, y ese -0 se filtraria al beat
    // del evento y al JSON del proyecto. Se normaliza a +0.
    if (primero === 0) primero = 0;
    var out = [];
    for (var b = primero; b < sectionEnd - 1e-9; b += paso) {
      out.push(b);
      if (!block.repeat) break;
    }
    return out;
  }

  function buildArrangementEvents(config) {
    config = config || {};
    var arrangement = config.arrangement;
    if (!arrangement || typeof arrangement.presenceAt !== 'function') return [];
    var project = normalizeProject(config.project || {});
    var bpb = beatsPerBar(project);
    var blocks = config.blocks || {};
    // Se normalizan igual que las del proyecto: una lane cruda trae mcTrack, no channel,
    // y sin esto el cruce con el CC nunca daria positivo.
    var lanes = (config.lanes || project.automationLanes || []).map(normalizeLane).filter(function (lane) {
      return lane.points.length;
    });
    var safeRowIds = config.safeRowIds || [];
    var onValue = Number.isFinite(config.onValue) ? config.onValue : 127;
    var rows = arrangement.rowIds();
    var events = [];

    var beat = 0;
    (config.sections || []).forEach(function (section, index) {
      var inicio = beat;
      beat += (Number(section && section.bars) || 0) * bpb;

      rows.forEach(function (rowId) {
        var presence = arrangement.presenceAt(rowId, index, { safeRowIds: safeRowIds });
        if (presence === 'none') return;
        var cell = arrangement.get(rowId, index);
        var block = cell && cell.blockId ? blocks[cell.blockId] : null;
        var escritos = [];

        if (block) {
          // UN BLOQUE ES DISPERSO HACIA AFUERA DE SU STEM Y COMPLETO HACIA ADENTRO.
          // Afuera no toca nada; adentro, lo que no nombra queda muteado. Es lo que hace
          // que «Offbeat + Ride» signifique que suenan esos dos y NO el resto del stem.
          var valores = (block.values || {})[rowId];
          if (valores) {
            Object.keys(valores).forEach(function (param) {
              escritos.push({ param: param, value: valores[param], source: 'block' });
            });
          } else {
            escritos.push({ param: 'level', value: 0, source: 'block-mute', mute: true });
          }
        } else {
          // PRESENCIA: solo Level, y solo si ningun bloque hablo por esta fila.
          escritos.push(presence === 'on'
            ? { param: 'level', value: onValue, source: 'presence' }
            : { param: 'level', value: 0, source: 'presence', mute: true });
        }

        // El bloque decide CUANDO; la presencia sigue cayendo en el borde de la seccion.
        var momentos = block ? triggerBeats(block, inicio, beat, bpb) : [inicio];
        escritos.forEach(function (escrito) {
          var target = controlTarget(rowId, escrito.param);
          if (!target) return;
          momentos.forEach(function (momento) {
          if (laneOwns(lanes, target.channel, target.cc, momento, project)) return;
          // Se clampea al RANGO UTIL del control, no a 0..127: si el filtro de este patch
          // vive entre 30 y 90, un bloque no puede mandarlo a 127, y "prender" es 90.
          //
          // EL MUTE ES LA EXCEPCION Y LLEGA A 0 DE VERDAD. Si el rango util del Level
          // arranca en 40 porque abajo de eso no se escucha, muteando al minimo del rango
          // el instrumento seguiria sonando. El rango acota el recorrido util; el silencio
          // no es parte del recorrido.
          var rango = controlRange(target.id, project.liveControls);
          var valor = escrito.mute
            ? clampInt(0, target.min, target.max, 0)
            : clampInt(escrito.value, rango.min, rango.max, rango.min);
          events.push({
            type: 'cc', beat: momento, bar: beatToBarFloat(project, momento),
            channel: target.channel, cc: target.cc, value: valor,
            rowId: rowId, sectionIndex: index, source: escrito.source
          });
          });
        });
      });
    });

    events.sort(function (a, b) { return a.beat - b.beat || a.channel - b.channel || a.cc - b.cc; });
    return events;
  }

  // ---------------------------------------------------------------- leer un .als
  //
  // El lector vive ACA y no en als.js: als.js es del producto y no se toca. Lo que se
  // agrega es conocimiento de hardware —los pares USB de la MC-707— que al producto no le
  // sirve. als.js entra por parametro, asi el core no depende de el para el resto.
  //
  // Medido sobre Grabaciones\TRACK1.als el 1-sep-2026.

  // EL ULTIMO LOCATOR MARCA EL FINAL, no una seccion. Se confirmo en dos Sets: TRACK1
  // termina con "FIN" y uno hecho por ArrangeLab con "09 END". Asi que N locators son
  // N-1 secciones. Y VIENEN DESORDENADOS en el XML: hay que ordenarlos por beat.
  function readStructure(xml, ALS, beatsPerBarValue) {
    var bpb = beatsPerBarValue || 4;
    var locators = (ALS.readLocators(xml) || []).slice().sort(function (a, b) { return a.beat - b.beat; });
    var sections = [];
    for (var i = 0; i < locators.length - 1; i++) {
      var beats = locators[i + 1].beat - locators[i].beat;
      if (beats <= 0) continue;
      // EL NOMBRE VIENE NUMERADO cuando el Set lo escribio ArrangeLab -"01 INTRO"-, y
      // ese numero es de la herramienta, no del tema: se saca al leer y se vuelve a poner
      // al escribir. Si no, cada vuelta agrega un prefijo mas.
      var crudo = String(locators[i].name || '').trim();
      var nombre = crudo.replace(/^\d{2}\s+/, '');
      // Y un locator llamado FILL vuelve como fill: es la unica marca que el .als puede
      // llevar, porque un <Locator> son cinco campos y ninguno dice "esto es un fill".
      sections.push({ name: nombre, bars: beats / bpb, beats: beats,
                      fill: nombre.toUpperCase() === 'FILL' });
    }
    var totalBars = sections.reduce(function (acc, s) { return acc + s.bars; }, 0);
    return { bpb: bpb, sections: sections, totalBars: totalBars,
             endName: locators.length
               ? String(locators[locators.length - 1].name || '').trim().replace(/^\d{2}\s+/, '')
               : '' };
  }

  // ------------------------------------------------------ la estructura como timeline
  //
  // Los locators dejan de ser una linea de log y pasan a ser parte del proyecto: se
  // guardan con el preset y viajan en el Export JSON. El formato es el que ya fijo
  // HARDWARE_ARRANGEMENT_DESIGN.md 2 bis -{ bpb, sections: [{ name, bars }] }- mas el
  // nombre del archivo del que salieron, que es contexto y no dato musical.
  //
  // ESTO NO ENVIA NADA. Es geometria: donde empieza y donde termina cada seccion. Los
  // bloques de performance se van a colgar de aca, pero todavia no existen.
  function normalizeStructure(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var sections = (Array.isArray(raw.sections) ? raw.sections : []).map(function (section, i) {
      var bars = Number(section && section.bars);
      if (!Number.isFinite(bars) || bars <= 0) return null;
      var color = String((section && section.color) || '').trim();
      return {
        name: String((section && section.name) || '').trim() || ('SECTION ' + (i + 1)),
        // Un locator puede no caer en el borde de un compas: se conserva el largo real
        // redondeado al milesimo en vez de mentir un entero.
        bars: Math.round(bars * 1000) / 1000,
        // EL COLOR ES DE LA INTERFAZ Y NO SE ESCRIBE EN EL .als: un <Locator> son cinco
        // campos y ninguno es color. Se materializa al normalizar -el que le toca por
        // indice- para que despues VIAJE CON LA SECCION: si se quedara implicito, mover
        // una seccion le cambiaria el color, que es lo que hace ArrangeLab y lo que
        // esperaba Tomas.
        color: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : SECTION_PALETTE[i % SECTION_PALETTE.length],
        // FILL: la seccion corta que anuncia el cambio. Por ahora es una marca visual y
        // nada mas: en CC-only todavia no dispara nada.
        fill: !!(section && section.fill)
      };
    }).filter(Boolean);
    if (!sections.length) return null;
    return {
      source: String(raw.source || '').slice(0, 120),
      endName: String(raw.endName || '').slice(0, 120),
      bpb: clampInt(raw.bpb, 1, 32, 4),
      sections: sections
    };
  }

  function structureTotalBars(structure) {
    if (!structure || !structure.sections || !structure.sections.length) return 0;
    return structure.sections.reduce(function (acc, s) { return acc + s.bars; }, 0);
  }

  // Las secciones ya ubicadas: cada una sabe en que compas empieza y en cual termina.
  // Es lo que dibuja la timeline y lo que despues va a decidir en que tramo cae un bloque.
  // El compas es 1-based como en Live y `endBar` es exclusivo: la seccion que empieza en
  // 1 y dura 16 termina en 17, que es donde empieza la siguiente.
  //
  // Los beats salen de `beatsPerBar(project)` y no de `structure.bpb`: el transporte y las
  // lanes ya miden en esa unidad, y mezclar dos varas seria peor que ignorar una.
  function sectionTimeline(project) {
    var structure = project && project.structure;
    if (!structure || !structure.sections || !structure.sections.length) return [];
    var bpb = beatsPerBar(project);
    var bar = 1;
    return structure.sections.map(function (section, index) {
      var startBar = bar;
      bar = Math.round((bar + section.bars) * 1000) / 1000;
      return {
        index: index,
        name: section.name,
        bars: section.bars,
        color: section.color || '',
        fill: !!section.fill,
        startBar: startBar,
        endBar: bar,
        startBeat: (startBar - 1) * bpb,
        endBeat: (bar - 1) * bpb
      };
    });
  }

  // En que seccion cae un compas. Sirve para decir donde esta el cabezal y, mas adelante,
  // a que seccion pertenece un bloque. Fuera de la estructura devuelve null: el compas del
  // ultimo locator es el FINAL del tema y no una seccion mas.
  function sectionAtBar(project, bar) {
    var list = sectionTimeline(project);
    for (var i = 0; i < list.length; i += 1) {
      if (bar >= list[i].startBar && bar < list[i].endBar) return list[i];
    }
    return null;
  }

  // CAMBIAR EL RANGO NO RECORTA: REESCALA. Un bloque dibujado entre 30 y 90 tiene que
  // seguir siendo el mismo dibujo cuando el rango pasa a 0-127; lo que cambia es cuanto
  // se abre. Asi un bloque se reusa en dos controles distintos: el largo lo da la seccion
  // y el alto lo da el rango.
  function rescaleLanePoints(project, controlId, viejo, nuevo) {
    var desdeMin = Number(viejo && viejo.min), desdeMax = Number(viejo && viejo.max);
    var hastaMin = Number(nuevo && nuevo.min), hastaMax = Number(nuevo && nuevo.max);
    if (![desdeMin, desdeMax, hastaMin, hastaMax].every(Number.isFinite)) return project;
    if (desdeMax === desdeMin) return project;
    var lanes = (project.automationLanes || []).map(function (lane) {
      if (lane.controlId !== controlId) return lane;
      return Object.assign({}, lane, { points: (lane.points || []).map(function (point) {
        var t = (point.value - desdeMin) / (desdeMax - desdeMin);
        return { bar: point.bar, value: Math.round(hastaMin + Math.max(0, Math.min(1, t)) * (hastaMax - hastaMin)) };
      }) });
    });
    return Object.assign({}, project, { automationLanes: lanes });
  }

  // ------------------------------------------------------- editar la estructura
  //
  // UNA SOLA OPERACION PARA TODO. Estirar una seccion, renombrarla, agregar, borrar y
  // mover son el mismo movimiento: se declara la lista nueva de secciones diciendo DE
  // DONDE VIENE cada una (`from`, el indice viejo, o -1 si es nueva), y los puntos de las
  // lanes viajan con su seccion.
  //
  // LA REGLA DE LAS ENVOLVENTES: un punto guarda su posicion RELATIVA dentro de la
  // seccion en la que estaba. Si el break pasa de 32 a 48 compases, el barrido que lo
  // cruzaba sigue cruzandolo entero en vez de terminar a dos tercios; lo que venia
  // despues se corre con el.
  //
  //   · seccion que se estira o se achica  -> los puntos de adentro se escalan
  //   · seccion que se mueve de lugar      -> sus puntos se van con ella
  //   · seccion que se borra               -> sus puntos se borran con ella
  //   · punto fuera de toda seccion        -> se pega al final
  // `opciones.conservarPuntos` deja los puntos donde estan en el tiempo. Sirve para las
  // operaciones que NO mueven nada: partir una seccion en dos -un fill- o volver a
  // juntarlas. El tema dura lo mismo y los bordes de adentro son los unicos que cambian,
  // asi que escalar los puntos los correria sin motivo.
  function remapStructure(project, nuevas, opciones) {
    var base = project && project.structure ? project.structure : {};
    var viejas = sectionTimeline(project);
    var estructura = normalizeStructure({
      source: base.source, endName: base.endName, bpb: base.bpb,
      sections: (nuevas || []).map(function (s) {
        return { name: s.name, bars: s.bars, color: s.color, fill: s.fill };
      })
    });
    // Sin secciones no hay estructura, y sin estructura la pagina no tiene largo: se
    // devuelve el proyecto como estaba en vez de dejarlo sin timeline por accidente.
    if (!estructura) return normalizeProject(project);

    // Los rangos nuevos se calculan con un proyecto de descarte: hacen falta ANTES de
    // mover los puntos.
    var nuevos = sectionTimeline(normalizeProject({
      timeSignature: project.timeSignature, structure: estructura
    }));
    var destino = {};
    // `copiaDe` es una seccion NUEVA que sale de duplicar una vieja: no hereda sus puntos
    // -esos se quedan con el original- pero SI se le copian, escalados a su propio largo.
    // Duplicar una seccion tiene que traer su envolvente; si no, la copia suena distinta.
    var copias = [];
    (nuevas || []).forEach(function (s, i) {
      var from = Number(s.from);
      if (Number.isFinite(from) && from >= 0 && nuevos[i]) destino[from] = nuevos[i];
      var de = Number(s.copiaDe);
      if (Number.isFinite(de) && de >= 0 && viejas[de] && nuevos[i]) {
        copias.push({ desde: viejas[de], hacia: nuevos[i] });
      }
    });
    var finalBar = nuevos.length ? Math.ceil(nuevos[nuevos.length - 1].endBar) - 1 : 1;

    if (opciones && opciones.conservarPuntos) {
      return normalizeProject(Object.assign({}, project, { structure: estructura }));
    }

    var lanes = (project.automationLanes || []).map(function (lane) {
      var puntos = [];
      (lane.points || []).forEach(function (point) {
        var indice = -1;
        for (var i = 0; i < viejas.length; i += 1) {
          if (point.bar >= viejas[i].startBar && point.bar < viejas[i].endBar) { indice = i; break; }
        }
        if (indice < 0) { puntos.push({ bar: finalBar, value: point.value }); return; }
        var hacia = destino[indice];
        if (!hacia) return;
        var vieja = viejas[indice];
        var t = vieja.bars > 0 ? (point.bar - vieja.startBar) / vieja.bars : 0;
        puntos.push({ bar: Math.round(hacia.startBar + t * hacia.bars), value: point.value });
      });
      copias.forEach(function (copia) {
        (lane.points || []).forEach(function (point) {
          if (point.bar < copia.desde.startBar || point.bar >= copia.desde.endBar) return;
          var t = copia.desde.bars > 0 ? (point.bar - copia.desde.startBar) / copia.desde.bars : 0;
          puntos.push({ bar: Math.round(copia.hacia.startBar + t * copia.hacia.bars), value: point.value });
        });
      });
      puntos.sort(sortByBar);
      return Object.assign({}, lane, { points: dedupePoints(puntos) });
    });

    return normalizeProject(Object.assign({}, project, { structure: estructura, automationLanes: lanes }));
  }

  // La lista de secciones lista para editar: cada una sabe de donde viene, asi que
  // reordenarla o cambiarle un largo alcanza para llamar a remapStructure.
  function editableSections(project) {
    var crudas = (project && project.structure && project.structure.sections) || [];
    return sectionTimeline(project).map(function (s, i) {
      var cruda = crudas[i] || {};
      return { name: s.name, bars: s.bars, color: cruda.color || '', fill: !!cruda.fill, from: s.index };
    });
  }

  // S<n> ES EL PAR ESTEREO 0-BASED: canales 2n+1 / 2n+2. Sin una sola excepcion en las
  // nueve entradas de TRACK1.als.
  function pairFromTarget(target) {
    var m = /AudioIn\/External\/S(\d+)/.exec(String(target || ''));
    if (!m) return null;
    var n = Number(m[1]);
    return { index: n, left: n * 2 + 1, right: n * 2 + 2, label: (n * 2 + 1) + '/' + (n * 2 + 2) };
  }

  // Las pistas que Tomas graba de verdad, con su entrada. Es lo que tiene que definir las
  // filas de la matriz: la tabla escrita a mano no coincidia con el Set.
  function readRecordingTracks(xml, ALS) {
    var lista = ALS.listaTracks(xml) || [];
    var porId = {};
    lista.forEach(function (t) { porId[String(t.id)] = t; });
    return lista.map(function (t) {
      var bloque = xml.slice(t.ini, t.fin);
      var ruteo = /<AudioInputRouting>[\s\S]*?<\/AudioInputRouting>/.exec(bloque);
      var target = ruteo ? (/<Target Value="([^"]*)"/.exec(ruteo[0]) || [])[1] : '';
      var lower = ruteo ? (/<LowerDisplayString Value="([^"]*)"/.exec(ruteo[0]) || [])[1] : '';
      var padre = porId[String(t.grupo)];
      var par = pairFromTarget(target);
      // EL BUS DE LA MAQUINA VS EL NOMBRE DE LA PISTA.
      //
      // LowerDisplayString es "9/10 HHs": los canales y despues el nombre que la MC-707 le
      // da a esa salida USB. Ese nombre es de la maquina y no cambia. El EffectiveName de
      // la pista, en cambio, lo cambia Tomas cuando quiere, y ya no coinciden: en
      // ArrangelabHardware.als la pista "DRUM" entra por 15/16, que es "PAD(Noise", y la
      // pista "NOISE" entra por 17/18, que es "DRUMMC".
      //
      // Por eso LA IDENTIDAD ES EL PAR USB, no el nombre: "un lead puede ser un acid".
      // El nombre es una etiqueta y se respeta como tal.
      var bus = lower ? String(lower).replace(/^\s*\d+\/\d+\s*/, '').trim() : '';
      return {
        id: t.id, name: t.nombre, type: t.tipo,
        groupId: t.grupo, groupName: padre ? padre.nombre : '',
        target: target || '', inputName: lower || '',
        busName: bus, pair: par,
        // El par es lo estable; con el se identifica la pista entre Sets distintos.
        key: par ? 'S' + par.index : '',
        // Solo las pistas de audio que NO son grupo ni return se graban.
        recorded: t.tipo === 'AudioTrack'
      };
    });
  }

  // ------------------------------------------------- los clips: donde suena cada canal
  //
  // El .als no dice solo la estructura: dice DONDE SUENA CADA PISTA, que es la mitad del
  // arreglo. Cada clip del Arrangement es un tramo en el que ese canal esta sonando; el
  // resto del tema esta en silencio. De ahi salen los prendidos y apagados de CC.
  //
  // Sirve igual para dos casos y por eso no distingue el tipo de clip:
  //   · un Set grabado, donde los clips son el audio de cada bus de la MC-707
  //   · un Set con pistas GUIDE, donde ArrangeLab ya escribio clips MIDI de guia
  //
  // Los clips pegados se juntan en un solo tramo: dos clips consecutivos de kick son un
  // kick que no paro de sonar, y si no se juntaran quedarian dos escalones inutiles -y
  // cuatro puntos en el mismo compas, que no se pueden ni ver-.
  function readArrangementClips(xml, ALS) {
    var lista = ALS.listaTracks(xml) || [];
    return lista.map(function (t) {
      var bloque = xml.slice(t.ini, t.fin);
      var zona = /<ArrangerAutomation>([\s\S]*?)<\/ArrangerAutomation>/.exec(bloque);
      var regiones = [];
      if (zona) {
        var re = /<(?:Audio|Midi)Clip\b[^>]*\sTime="([-\d.eE]+)"[\s\S]*?<CurrentStart Value="([-\d.eE]+)"[\s\S]*?<CurrentEnd Value="([-\d.eE]+)"/g;
        var m;
        while ((m = re.exec(zona[1])) !== null) {
          var desde = parseFloat(m[1]);
          var largo = parseFloat(m[3]) - parseFloat(m[2]);
          if (!Number.isFinite(desde) || !(largo > 0)) continue;
          regiones.push({ startBeat: desde, endBeat: desde + largo });
        }
      }
      regiones.sort(function (a, b) { return a.startBeat - b.startBeat; });
      var juntas = [];
      regiones.forEach(function (r) {
        var ultima = juntas[juntas.length - 1];
        // Pegados o encimados: un solo tramo. La tolerancia es de un tick, no de un compas.
        if (ultima && r.startBeat <= ultima.endBeat + 1e-6) {
          if (r.endBeat > ultima.endBeat) ultima.endBeat = r.endBeat;
          return;
        }
        juntas.push({ startBeat: r.startBeat, endBeat: r.endBeat });
      });
      var par = pairFromTarget((/<AudioInputRouting>[\s\S]*?<Target Value="([^"]*)"/.exec(bloque) || [])[1]);
      return { id: t.id, name: t.nombre, type: t.tipo, key: par ? 'S' + par.index : '',
               regions: juntas };
    }).filter(function (t) { return t.regions.length; });
  }

  // De los tramos de una pista a los puntos de una lane: apagado afuera, al maximo
  // adentro, con ESCALONES en los bordes -dos puntos en el mismo compas- para que el
  // corte sea seco y no una rampa.
  //
  // Los bordes se redondean al compas: un clip que arranca dos ticks tarde por como
  // quedo grabado no tiene que dejar el CC a mitad de camino.
  function clipsToLanePoints(project, regions, rango) {
    var bpb = beatsPerBar(project);
    var total = project.totalBars;
    var apagado = Number.isFinite(rango && rango.min) ? rango.min : 0;
    var prendido = Number.isFinite(rango && rango.max) ? rango.max : 127;
    var puntos = [];
    function poner(bar, valor) {
      var ultimo = puntos[puntos.length - 1];
      if (ultimo && ultimo.bar === bar && ultimo.value === valor) return;
      puntos.push({ bar: bar, value: valor });
    }

    // SE VUELVEN A JUNTAR EN COMPASES. Dos tramos separados por medio compas quedan
    // pegados al redondear, y sin esto saldrian un apagado y un prendido en el mismo
    // lugar: cuatro puntos en un compas, que no se pueden ni ver ni tocar.
    var enCompases = [];
    (regions || []).forEach(function (region) {
      var d = Math.max(1, Math.round(region.startBeat / bpb) + 1);
      var h = Math.max(d + 1, Math.round(region.endBeat / bpb) + 1);
      var ultima = enCompases[enCompases.length - 1];
      if (ultima && d <= ultima.hasta) { ultima.hasta = Math.max(ultima.hasta, h); return; }
      enCompases.push({ desde: d, hasta: h });
    });

    enCompases.forEach(function (region) {
      var desde = region.desde;
      var hasta = region.hasta;
      if (desde > total) return;
      // Antes de entrar tiene que estar apagado: sin este punto, el tramo anterior
      // llegaria en rampa hasta el maximo en vez de saltar.
      if (!puntos.length && desde > 1) poner(1, apagado);
      if (puntos.length) poner(desde, apagado);
      poner(desde, prendido);
      if (hasta > total) { poner(total, prendido); return; }
      poner(hasta, prendido);
      poner(hasta, apagado);
    });
    return puntos;
  }

  // EL PERFIL DE HARDWARE: que bus de la MC-707 entra por cada par USB. Es lo unico
  // estable entre Sets —los nombres y los colores de pista cambian— asi que es lo que hay
  // que guardar para reconocer una pista en otro Set.
  function hardwareProfile(tracks) {
    var porPar = {};
    (tracks || []).forEach(function (t) {
      if (!t.recorded || !t.pair) return;
      porPar[t.key] = { key: t.key, pair: t.pair.label, channels: [t.pair.left, t.pair.right],
                        bus: t.busName, trackName: t.name };
    });
    return Object.keys(porPar).sort(function (a, b) {
      return Number(a.slice(1)) - Number(b.slice(1));
    }).map(function (k) { return porPar[k]; });
  }

  // ---------------------------------------------------------------- escribir un .als
  //
  // NUNCA SE TOCA EL ORIGINAL. Se parte del Set que Tomas cargo y se devuelve un XML
  // nuevo: asi se conservan devices, mezcla, returns, automatizaciones y todo lo que no
  // es asunto nuestro. Es la misma decision que ya tomo el producto.
  //
  // Y SE RENOMBRA POR BUS, NO POR NOMBRE. El nombre viejo no sirve para encontrar la
  // pista —justamente es lo que cambia—, asi que la llave es el par USB.

  function trackByKey(tracks, key) {
    for (var i = 0; i < tracks.length; i++) if (tracks[i].key === key) return tracks[i];
    return null;
  }

  // Cambia la entrada de una pista: el par estereo y, si se pide, el nombre del bus.
  // El LowerDisplayString de Live es "<canales> <bus>", asi que se rearma completo.
  function setTrackInputRouting(xml, ALS, trackId, pairIndex, busName) {
    var lista = ALS.listaTracks(xml) || [];
    var t = null;
    for (var i = 0; i < lista.length; i++) if (String(lista[i].id) === String(trackId)) t = lista[i];
    if (!t) return null;
    var blk = xml.slice(t.ini, t.fin);
    var m = /<AudioInputRouting>[\s\S]*?<\/AudioInputRouting>/.exec(blk);
    if (!m) return null;
    var par = pairFromTarget('AudioIn/External/S' + pairIndex);
    if (!par) return null;
    var lower = par.label + (busName ? ' ' + busName : '');
    var nuevoRuteo = m[0]
      .replace(/<Target Value="[^"]*"/, '<Target Value="AudioIn/External/S' + par.index + '"')
      .replace(/<LowerDisplayString Value="[^"]*"/, '<LowerDisplayString Value="' + escapeXml(lower) + '"');
    var nuevoBlk = blk.slice(0, m.index) + nuevoRuteo + blk.slice(m.index + m[0].length);
    return xml.slice(0, t.ini) + nuevoBlk + xml.slice(t.fin);
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // nombres: { S1:'ACID', S6:'PAD' }. Devuelve { xml, cambios, ignorados }.
  // Un nombre vacio o igual al que ya tiene NO se escribe: no se ensucia el XML por gusto.
  function renameTracksByBus(xml, ALS, nombres) {
    var out = xml, cambios = [], ignorados = [];
    var pedidos = Object.keys(nombres || {});
    pedidos.forEach(function (key) {
      var nombre = String(nombres[key] === undefined ? '' : nombres[key]).trim();
      // Se relee en cada vuelta: renombrar corre los indices del XML.
      var t = trackByKey(readRecordingTracks(out, ALS), key);
      if (!t) { ignorados.push(key + ': no hay pista en ese par'); return; }
      if (!nombre) { ignorados.push(key + ': nombre vacio'); return; }
      if (nombre === t.name) { ignorados.push(key + ': ya se llama asi'); return; }
      var siguiente = ALS.renombrarTrack(out, t.id, nombre);
      if (!siguiente) { ignorados.push(key + ': no se pudo renombrar'); return; }
      out = siguiente;
      cambios.push({ key: key, pair: t.pair.label, bus: t.busName, de: t.name, a: nombre });
    });
    return { xml: out, cambios: cambios, ignorados: ignorados };
  }

  // UNA SUGERENCIA, NO UNA VERDAD. El nombre del bus de la MC-707 suele decir que hay
  // adentro ("KICK+TOM", "HHs", "ACID"), asi que se propone una asignacion para no arrancar
  // de cero. Es un punto de partida editable: el Set no tiene el dato real.
  var PISTAS_POR_BUS = [
    [/kick|bd/i,            ['tr8s-bd', 'tr8s-lt']],
    [/hh|hat/i,             ['tr8s-ch', 'tr8s-oh']],
    [/drum|perc/i,          ['tr8s-sd', 'tr8s-mt', 'tr8s-ht', 'tr8s-rs', 'tr8s-hc', 'tr8s-cc', 'tr8s-rc']],
    [/bass|sub/i,           ['mc2']],
    [/acid/i,               ['mc5']],
    [/lead/i,               ['mc6']],
    [/pad|noise|synth/i,    ['mc7', 'mc8']]
  ];

  function suggestDeviceChannels(tracks) {
    var out = {};
    var usados = {};
    (tracks || []).forEach(function (t) {
      if (!t.recorded || !t.key) return;
      // SOLO EL BUS, no el nombre de la pista. En ArrangelabHardware.als la pista se
      // llama "DRUM" pero entra por el bus "PAD(Noise": mirar el nombre mandaba toda la
      // bateria al canal equivocado.
      var texto = t.busName || '';
      PISTAS_POR_BUS.forEach(function (regla) {
        if (!regla[0].test(texto)) return;
        regla[1].forEach(function (deviceId) {
          // El primer canal que reclama un device se lo queda: si dos buses matchean la
          // misma regla, no se reparte el mismo instrumento en dos pistas.
          if (usados[deviceId]) return;
          usados[deviceId] = true;
          out[deviceId] = t.key;
        });
      });
    });
    return out;
  }

  function buildPlaybackPlan(project, options) {
    var safe = normalizeProject(project);
    var events = buildAutomationEvents(safe, options);
    events.sort(function (a, b) {
      if (a.beat !== b.beat) return a.beat - b.beat;
      if (a.type === b.type) return 0;
      return a.type === 'programChange' ? -1 : 1;
    });
    return {
      project: safe,
      endBeat: getProjectEndBeat(safe),
      events: events
    };
  }

  function describeBeat(project, beat) {
    var bars = beatsPerBar(project);
    var wholeBars = Math.floor(beat / bars);
    var beatInBar = Math.floor(beat - wholeBars * bars);
    return (wholeBars + 1) + '.' + (beatInBar + 1);
  }

  function formatEvent(project, event) {
    if (event.type === 'programChange') {
      return 'SEND BAR ' + event.sendBar + ' → SCENE BAR ' + event.bar + ' PC CH' + event.channel + ' VALUE ' + event.program;
    }
    return 'BAR ' + describeBeat(project, event.beat) + ' CC CH' + event.channel + ' CC' + event.cc + ' VALUE ' + event.value;
  }

  function Transport(opts) {
    opts = opts || {};
    this.bpm = clampInt(opts.bpm, 20, 300, DEFAULT_PROJECT.bpm);
    this.running = false;
    this.startTimeMs = 0;
    this.startBeat = 0;
    this.pausedBeat = 0;
  }

  Transport.prototype.start = function (nowMs, startBeat) {
    this.running = true;
    this.startTimeMs = Number(nowMs) || 0;
    this.startBeat = Number.isFinite(startBeat) ? startBeat : this.pausedBeat;
  };

  Transport.prototype.stop = function (nowMs) {
    this.pausedBeat = this.getCurrentBeat(nowMs);
    this.running = false;
  };

  Transport.prototype.reset = function () {
    this.running = false;
    this.startTimeMs = 0;
    this.startBeat = 0;
    this.pausedBeat = 0;
  };

  Transport.prototype.msPerBeat = function () {
    return 60000 / this.bpm;
  };

  Transport.prototype.getCurrentBeat = function (nowMs) {
    if (!this.running) return this.pausedBeat;
    return this.startBeat + ((Number(nowMs) - this.startTimeMs) / this.msPerBeat());
  };

  Transport.prototype.beatToTimestamp = function (beat) {
    return this.startTimeMs + ((beat - this.startBeat) * this.msPerBeat());
  };

  function Scheduler(opts) {
    opts = opts || {};
    this.transport = opts.transport;
    this.lookAheadMs = Number(opts.lookAheadMs) || 25;
    this.scheduleAheadMs = Number(opts.scheduleAheadMs) || 120;
    this.onSchedule = typeof opts.onSchedule === 'function' ? opts.onSchedule : function () {};
    this.timer = null;
    this.plan = null;
    this.cursor = 0;
  }

  Scheduler.prototype.start = function (plan, nowMs) {
    this.stop();
    this.plan = plan;
    this.cursor = 0;
    if (!this.transport.running) this.transport.start(nowMs || 0, 0);
    var self = this;
    this.timer = setInterval(function () {
      self.tick(performanceNow());
    }, this.lookAheadMs);
  };

  Scheduler.prototype.tick = function (nowMs) {
    if (!this.plan || !this.transport.running) return;
    var currentBeat = this.transport.getCurrentBeat(nowMs);
    var endBeat = currentBeat + (this.scheduleAheadMs / this.transport.msPerBeat());
    while (this.cursor < this.plan.events.length) {
      var ev = this.plan.events[this.cursor];
      if (ev.beat > endBeat) break;
      var at = this.transport.beatToTimestamp(ev.beat);
      this.onSchedule(ev, at);
      this.cursor += 1;
    }
  };

  Scheduler.prototype.replacePlan = function (plan, nowMs) {
    this.plan = plan;
    if (!this.transport || !this.transport.running) {
      this.cursor = 0;
      return;
    }
    // Events inside the look-ahead window may already be on the MIDI output queue.
    var protectedBeat = this.transport.getCurrentBeat(nowMs) + (this.scheduleAheadMs / this.transport.msPerBeat());
    this.cursor = 0;
    while (this.cursor < plan.events.length && plan.events[this.cursor].beat <= protectedBeat) {
      this.cursor += 1;
    }
  };

  Scheduler.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.plan = this.plan || null;
  };

  function MidiClock(opts) {
    opts = opts || {};
    this.midiEngine = opts.midiEngine;
    this.bpm = clampInt(opts.bpm, 20, 300, DEFAULT_PROJECT.bpm);
    this.lookAheadMs = Number(opts.lookAheadMs) || 25;
    this.scheduleAheadMs = Number(opts.scheduleAheadMs) || 100;
    this.timer = null;
    this.nextTickMs = 0;
  }

  function defaultPerformanceStems() {
    return DEFAULT_STEMS.map(function (stem) {
      var values = {};
      var parameters = stem[4].map(function (parameter) { values[parameter[0]] = 0; return { id: parameter[0], cc: parameter[1], name: parameter[2] }; });
      return { id: stem[0], name: stem[1], channel: stem[2], destination: stem[3], parameters: parameters, blocks: [{ id: 'mute', name: 'Mute', values: values }], arrangement: [] };
    });
  }

  function normalizeStem(stem, index) {
    var safe = stem || {};
    var parameters = (safe.parameters || []).map(function (parameter, i) { return { id: parameter.id || ('p' + i), cc: clampInt(parameter.cc, 0, 127, 7), name: parameter.name || ('CC ' + parameter.cc) }; });
    var blocks = (safe.blocks || []).map(function (block, i) { var values = {}; parameters.forEach(function (p) { values[p.id] = clampInt(block && block.values && block.values[p.id], 0, 127, 0); }); return { id: block.id || ('block-' + i), name: block.name || ('Block ' + i), values: values }; });
    if (!blocks.some(function (block) { return block.id === 'mute'; })) { var mute = {}; parameters.forEach(function (p) { mute[p.id] = 0; }); blocks.unshift({ id: 'mute', name: 'Mute', values: mute }); }
    var arrangement = (safe.arrangement || []).map(function (cell) { return { bar: Math.max(1, Math.round((clampInt(cell.bar, 1, 9999, 1) - 1) / 8) * 8 + 1), blockId: cell.blockId || 'mute' }; }).sort(sortByBar);
    return { id: safe.id || ('stem-' + index), name: safe.name || ('Stem ' + index), channel: clampInt(safe.channel, 1, 16, 1), destination: safe.destination || 'mc707', parameters: parameters, blocks: blocks, arrangement: dedupeBars(arrangement) };
  }

  function ccOptionsForMcTrack(mcTrack) {
    var track = clampInt(mcTrack, 1, 8, 5);
    return clone(CC_CATALOGS[MC_TRACK_DESTINATIONS[track]]);
  }

  MidiClock.prototype.msPerTick = function () {
    return 60000 / this.bpm / 24;
  };

  MidiClock.prototype.start = function (nowMs) {
    this.stop();
    this.nextTickMs = Number(nowMs) || 0;
    this.tick(this.nextTickMs);
    var self = this;
    this.timer = setInterval(function () {
      self.tick(performanceNow());
    }, this.lookAheadMs);
  };

  MidiClock.prototype.tick = function (nowMs) {
    if (!this.midiEngine) return;
    var horizon = Number(nowMs) + this.scheduleAheadMs;
    while (this.nextTickMs <= horizon) {
      this.midiEngine.sendClock(this.nextTickMs);
      this.nextTickMs += this.msPerTick();
    }
  };

  MidiClock.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  function performanceNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function MidiEngine() {
    this.access = null;
    this.output = null;
    this.sink = null;
    this.dryRunSink = null;
  }

  function WebMidiSink(output) {
    this.output = output;
  }

  WebMidiSink.prototype.send = function (message, timestamp) {
    if (!this.output) return;
    this.output.send(message, timestamp);
  };

  function DryRunMidiSink() {
    this.trace = [];
  }

  DryRunMidiSink.prototype.send = function (message, timestamp, metadata) {
    var entry = {
      timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : 0,
      message: message.slice(),
      source: (metadata && metadata.source) || 'unknown',
      logicalDestination: (metadata && metadata.logicalDestination) || '',
      physicalOutput: (metadata && metadata.physicalOutput) || ''
    };
    this.trace.push(entry);
    if (this.trace.length > 500) this.trace.shift();
    return entry;
  };

  MidiEngine.prototype.requestAccess = async function () {
    if (!navigator || !navigator.requestMIDIAccess) {
      throw new Error('Web MIDI no disponible en este navegador.');
    }
    this.access = await navigator.requestMIDIAccess();
    return this.access;
  };

  MidiEngine.prototype.listOutputs = function () {
    if (!this.access) return [];
    var outputs = [];
    this.access.outputs.forEach(function (output) {
      outputs.push({ id: output.id, name: output.name || output.manufacturer || output.id });
    });
    return outputs;
  };

  MidiEngine.prototype.connect = function (outputId) {
    if (!this.access) throw new Error('MIDI access no inicializado.');
    var output = this.access.outputs.get(outputId);
    if (!output) throw new Error('Output MIDI no encontrado.');
    this.output = output;
    if (!this.dryRunSink) this.sink = new WebMidiSink(output);
    return output;
  };

  MidiEngine.prototype.setDryRun = function (enabled) {
    if (enabled) {
      this.dryRunSink = new DryRunMidiSink();
      this.sink = this.dryRunSink;
    } else {
      this.dryRunSink = null;
      this.sink = this.output ? new WebMidiSink(this.output) : null;
    }
  };

  MidiEngine.prototype.getTrace = function () {
    return this.dryRunSink ? clone(this.dryRunSink.trace) : [];
  };

  MidiEngine.prototype.sendRaw = function (message, timestamp, metadata) {
    if (this.sink) return this.sink.send(message, timestamp, metadata || {});
    if (this.output) this.output.send(message, timestamp);
  };

  MidiEngine.prototype.sendProgramChange = function (channel, program, timestamp, metadata) {
    var status = 0xC0 | (clampInt(channel, 1, 16, 1) - 1);
    return this.sendRaw([status, clampInt(program, 0, 127, 0)], timestamp, metadata);
  };

  MidiEngine.prototype.sendCC = function (channel, cc, value, timestamp, metadata) {
    var status = 0xB0 | (clampInt(channel, 1, 16, 1) - 1);
    return this.sendRaw([
      status,
      clampInt(cc, 0, 127, 0),
      clampInt(value, 0, 127, 0)
    ], timestamp, metadata);
  };

  MidiEngine.prototype.sendStart = function (timestamp, metadata) {
    return this.sendRaw([0xFA], timestamp, metadata);
  };

  MidiEngine.prototype.sendStop = function (timestamp, metadata) {
    return this.sendRaw([0xFC], timestamp, metadata);
  };

  MidiEngine.prototype.sendClock = function (timestamp, metadata) {
    return this.sendRaw([0xF8], timestamp, metadata);
  };

  MidiEngine.prototype.sendEvent = function (event, timestamp, metadata) {
    if (!event) return;
    var eventMetadata = Object.assign({
      source: event.source || 'timeline',
      logicalDestination: event.destination || '',
      physicalOutput: 'MC-707 USB MIDI OUT'
    }, metadata || {});
    if (event.type === 'programChange') return this.sendProgramChange(event.channel, event.program, timestamp, eventMetadata);
    if (event.type === 'cc') return this.sendCC(event.channel, event.cc, event.value, timestamp, eventMetadata);
  };

  return {
    DEFAULT_PROJECT: clone(DEFAULT_PROJECT),
    MC_TRACK_MIDI_CHANNELS: clone(MC_TRACK_MIDI_CHANNELS),
    MC_TRACK_DESTINATIONS: clone(MC_TRACK_DESTINATIONS),
    rolandColors: function () { return clone(ROLAND_COLORS); },
    sectionPalette: function () { return clone(SECTION_PALETTE); },
    structureCatalog: structureCatalog,
    controlRegistry: controlRegistry,
    realtimeControls: controlRegistry,
    ccOptionsForMcTrack: ccOptionsForMcTrack,
    defaultPerformanceStems: defaultPerformanceStems,
    clone: clone,
    normalizeProject: normalizeProject,
    buildPlaybackPlan: buildPlaybackPlan,
    buildAutomationEvents: buildAutomationEvents,
    buildArrangementEvents: buildArrangementEvents,
    controlTarget: controlTarget,
    controlRange: controlRange,
    readStructure: readStructure,
    normalizeStructure: normalizeStructure,
    structureTotalBars: structureTotalBars,
    sectionTimeline: sectionTimeline,
    sectionAtBar: sectionAtBar,
    remapStructure: remapStructure,
    rescaleLanePoints: rescaleLanePoints,
    editableSections: editableSections,
    readRecordingTracks: readRecordingTracks,
    pairFromTarget: pairFromTarget,
    hardwareProfile: hardwareProfile,
    readArrangementClips: readArrangementClips,
    clipsToLanePoints: clipsToLanePoints,
    suggestDeviceChannels: suggestDeviceChannels,
    triggerBeats: triggerBeats,
    renameTracksByBus: renameTracksByBus,
    setTrackInputRouting: setTrackInputRouting,
    interpolateLaneValue: interpolateLaneValue,
    beatsPerBar: beatsPerBar,
    normalizeBar: normalizeBar,
    barToBeat: barToBeat,
    beatToBarFloat: beatToBarFloat,
    describeBeat: describeBeat,
    formatEvent: formatEvent,
    Transport: Transport,
    Scheduler: Scheduler,
    MidiClock: MidiClock,
    MidiEngine: MidiEngine
  };
});
