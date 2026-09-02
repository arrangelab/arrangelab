// als.js — manipulación del XML de un .als, en texto plano.
// Sirve igual en el navegador y en node, así se puede testear sin Ableton.
// No usa DOM ni librerías: sólo string, para que el resultado sea determinista.
(function (root) {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mmss(t) {
    var m = Math.floor(t / 60), s = Math.round(t % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Todos los Id="N" y los <...PointeeId Value="N"> del archivo, menos NextPointeeId.
  function maxId(xml) {
    var top = 0, m, re = /\bId="(\d+)"/g;
    while ((m = re.exec(xml))) top = Math.max(top, +m[1]);
    re = /<(\w*PointeeId)\s+Value="(\d+)"/g;
    while ((m = re.exec(xml))) if (m[1] !== 'NextPointeeId') top = Math.max(top, +m[2]);
    return top;
  }

  // Solo los PointeeId, que es contra lo que NextPointeeId tiene que compararse de verdad.
  //
  // Son DOS espacios de numeracion distintos y conviene no mezclarlos: el `Id="N"` de un
  // nodo (un clip, un locator, un device) y el `PointeeId` de un destino de automatizacion.
  // Medido sobre TRACK1.als, hecho enteramente por Live: NextPointeeId=25698 mientras que
  // el Id de nodo mas alto es 57178. Live lo abre sin chistar. O sea que NextPointeeId
  // NO tiene que superar a los Ids de nodo, solo a los PointeeId.
  function maxPointeeId(xml) {
    var top = 0, m, re = /<(\w*PointeeId)\s+Value="(\d+)"/g;
    while ((m = re.exec(xml))) if (m[1] !== 'NextPointeeId') top = Math.max(top, +m[2]);
    return top;
  }

  // Live rechaza el archivo si NextPointeeId no supera a los PointeeId.
  //
  // Se sigue usando maxId() —el maximo de los dos espacios— y no maxPointeeId, a proposito:
  // pasarse para arriba no cuesta nada y quedarse corto rompe el archivo. Ser conservador
  // aca es gratis.
  function fixNextPointeeId(xml) {
    var top = maxId(xml) + 1000;
    if (/<NextPointeeId\s+Value="\d+"\s*\/>/.test(xml)) {
      return xml.replace(/<NextPointeeId\s+Value="\d+"\s*\/>/, '<NextPointeeId Value="' + top + '" />');
    }
    return xml.replace(/<\/LiveSet>/, '\t<NextPointeeId Value="' + top + '" />\n</LiveSet>');
  }

  // secs: [{name, bars}]  ->  reemplaza TODOS los locators del Set
  function buildLocators(secs, bpm, beatsPerBar, startId) {
    var id = startId, beat = 0, out = [], made = [];
    var items = secs.map(function (s, i) {
      return { name: pad2(i + 1) + ' ' + s.name, bars: Number(s.bars) };
    });
    items.push({ name: pad2(secs.length + 1) + ' END', bars: 0 });

    items.forEach(function (it) {
      var t = beat * 60 / bpm;
      out.push('<Locator Id="' + id + '">' +
        '<LomId Value="0" />' +
        '<Time Value="' + trimNum(beat) + '" />' +
        '<Name Value="' + esc(it.name) + '" />' +
        '<Annotation Value="' + mmss(t) + '" />' +
        '<IsSongStart Value="false" />' +
        '</Locator>');
      made.push({ name: it.name, beat: beat, bar: beat / beatsPerBar + 1, time: mmss(t) });
      id++;
      beat += it.bars * beatsPerBar;
    });
    return { xml: out.join(''), made: made, endBeat: beat };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function trimNum(n) {
    var r = Math.round(n * 1e6) / 1e6;
    return (r === Math.floor(r)) ? String(r) : String(r);
  }

  // Ojo: el .als tiene <Locators> (contenedor) > <Locators> (la lista) y DESPUES del
  // cierre de la lista viene <NextLocatorMapping>. Solo se reemplaza la lista interna.
  var LIST = /(<Locators>\s*<Locators>)([\s\S]*?)(<\/Locators>)/;
  // Si el Set no tiene ningun locator, Live escribe la lista auto-cerrada: <Locators />.
  var LISTA_VACIA = /(<Locators>\s*)<Locators\s*\/>/;

  function setLocators(xml, secs, bpm, beatsPerBar) {
    var built = buildLocators(secs, bpm, beatsPerBar, maxId(xml) + 1);
    if (LIST.test(xml)) {
      xml = xml.replace(LIST, function (all, open, body, close) { return open + built.xml + close; });
    } else if (LISTA_VACIA.test(xml)) {
      xml = xml.replace(LISTA_VACIA, function (all, open) {
        return open + '<Locators>' + built.xml + '</Locators>';
      });
    } else {
      throw new Error('El .als no tiene la lista de <Locators>');
    }
    return { xml: fixNextPointeeId(xml), made: built.made, endBeat: built.endBeat };
  }

  // La cabecera del .als dice con qué Live se guardó. Todo lo que hace esta herramienta
  // se probó contra Live 11; el formato no está documentado y Ableton lo cambia entre
  // versiones mayores, así que conviene mirarlo y avisar en vez de fallar raro.
  function readVersion(xml) {
    var m = /<Ableton\b([^>]*)>/.exec(xml);
    if (!m) return null;
    function attr(n) { var a = new RegExp(n + '="([^"]*)"').exec(m[1]); return a ? a[1] : null; }
    var minor = attr('MinorVersion') || '';
    var mayor = /^(\d+)/.exec(minor);
    return {
      major: attr('MajorVersion'),
      minor: minor,
      creator: attr('Creator') || 'desconocido',
      live: mayor ? +mayor[1] : null      // 11, 12...
    };
  }

  // EL TEMPO VIVE EN DOS LADOS, Y EL QUE MANDA ES LA ENVOLVENTE.
  //
  // `<Tempo><Manual>` es el valor de la perilla. Pero el MasterTrack tiene SIEMPRE una
  // automation lane de tempo -aunque nadie la haya dibujado-, y cuando tiene un solo
  // evento en `Time="-63072000"` -el "menos infinito" de Live- ese evento ES el tempo del
  // tema. Los dos pueden no coincidir: medido el 2-sep-2026 sobre `Prueba.als`, `Manual`
  // decia 75 y el Set sonaba a 145.
  //
  // Por eso leer `Manual` devolvia un numero que no era el del tema, y escribir `Manual`
  // no cambiaba nada: Live seguia tocando la envolvente. Se leen y se escriben los dos.
  function tempoEnvelope(xml) {
    var t = /<Tempo>[\s\S]{0,1200}?<AutomationTarget Id="(\d+)"/.exec(xml);
    if (!t) return null;
    var re = /<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g, m;
    while ((m = re.exec(xml))) {
      var pid = /<PointeeId Value="(\d+)"/.exec(m[0]);
      if (!pid || pid[1] !== t[1]) continue;
      var eventos = [], rf = /<FloatEvent\b[^>]*?\sTime="([-\d.eE]+)"[^>]*?\sValue="([-\d.eE]+)"[^>]*\/>/g, f;
      while ((f = rf.exec(m[0]))) eventos.push({ time: parseFloat(f[1]), value: parseFloat(f[2]), texto: f[0] });
      return { id: t[1], ini: m.index, fin: m.index + m[0].length, bloque: m[0], eventos: eventos };
    }
    return null;
  }

  // Un tempo DIBUJADO a lo largo del tema: mas de un evento. Cambiarlo seria aplastar la
  // automatizacion, asi que no se toca y el que llama avisa.
  function tempoAutomatizado(xml) {
    var env = tempoEnvelope(xml);
    return !!(env && env.eventos.length > 1);
  }

  function readTempo(xml) {
    var env = tempoEnvelope(xml);
    if (env && env.eventos.length) {
      var evs = env.eventos.slice().sort(function (a, b) { return a.time - b.time; });
      if (isFinite(evs[0].value)) return evs[0].value;
    }
    var m = /<Tempo>[\s\S]*?<Manual Value="([\d.]+)"/.exec(xml);
    return m ? parseFloat(m[1]) : null;
  }

  function setTempo(xml, bpm) {
    var out = xml.replace(/(<Tempo>[\s\S]*?<Manual Value=")[\d.]+(")/, '$1' + bpm + '$2');
    var env = tempoEnvelope(out);
    if (env && env.eventos.length === 1) {
      var viejo = env.eventos[0].texto;
      var nuevo = viejo.replace(/(\sValue=")[-\d.eE]+(")/, '$1' + bpm + '$2');
      out = out.slice(0, env.ini) + env.bloque.replace(viejo, nuevo) + out.slice(env.fin);
    }
    return out;
  }

  function readTrackNames(xml) {
    var names = [], m, re = /<(AudioTrack|MidiTrack|ReturnTrack)\b[\s\S]*?<EffectiveName Value="([^"]*)"/g;
    while ((m = re.exec(xml))) names.push({ type: m[1], name: m[2] });
    return names;
  }

  function readLocators(xml) {
    var out = [], m;
    var block = LIST.exec(xml);
    if (!block) return out;
    var re = /<Locator\b[\s\S]*?<Time Value="([-\d.eE]+)"[\s\S]*?<Name Value="([^"]*)"/g;
    while ((m = re.exec(block[2]))) out.push({ beat: parseFloat(m[1]), name: m[2] });
    return out;
  }


  // ---------------------------------------------------------------- envolventes
  // Formas por seccion. t0/t1 en beats; los valores son 0..1 del parametro.
  //
  // `desde` es el valor en que quedo la seccion anterior. Las formas normales lo ignoran
  // -cada una arranca en su valor absoluto- y las que empiezan con `cont` lo usan como
  // punto de partida. Eso es lo que permite encadenar: una seccion sube hasta la mitad y
  // la siguiente sigue desde ahi, en vez de saltar de golpe al 0 y volver a subir.
  function shapePoints(shape, t0, t1, desde) {
    var parts = String(shape).split(':');
    var kind = parts[0];
    var rng = (parts[1] || '').split('-');
    var a = rng.length > 1 ? parseFloat(rng[0]) : 0;
    var b = rng.length > 1 ? parseFloat(rng[1]) : 1;
    var n = parts[2] ? parseInt(parts[2], 10) : 4;
    var eps = 0.001;
    // si es la primera seccion no hay de donde continuar: se arranca del piso
    var d = (typeof desde === 'number' && isFinite(desde)) ? desde : 0;

    // sigue desde donde quedo la anterior hasta el valor que se le pida (1 por defecto)
    if (kind === 'contup')   return [[t0, d], [t1 - eps, parts[1] ? parseFloat(parts[1]) : 1]];
    if (kind === 'contdown') return [[t0, d], [t1 - eps, parts[1] ? parseFloat(parts[1]) : 0]];
    // se queda quieta en el valor que traia
    if (kind === 'hold')     return [[t0, d], [t1 - eps, d]];

    if (kind === 'flat') { var v = parts[1] ? parseFloat(parts[1]) : 0.5; return [[t0, v], [t1 - eps, v]]; }
    if (kind === 'up')   return [[t0, a], [t1 - eps, b]];
    if (kind === 'down') return [[t0, b], [t1 - eps, a]];
    if (kind === 'dip')  return [[t0, b], [(t0 + t1) / 2, a], [t1 - eps, b]];
    if (kind === 'saw') {
      var out = [], step = (t1 - t0) / n;
      for (var k = 0; k < n; k++) { out.push([t0 + k * step, a]); out.push([t0 + (k + 1) * step - eps, b]); }
      return out;
    }
    throw new Error('Forma desconocida: ' + shape);
  }

  function clamp01(v) {
    v = parseFloat(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  // Un trazo libre dentro de una seccion. Los puntos llegan en beats LOCALES a la
  // seccion, en el 0..1 de la UI. Se ordenan, se recortan al largo real y se extienden
  // hasta los bordes para que la seccion siempre quede completamente definida.
  function drawPoints(localPts, t0, t1) {
    var eps = 0.001;
    var largo = Math.max(eps, t1 - t0);
    var fin = Math.max(0, largo - eps);
    var pts = (localPts || [])
      .filter(function (p) { return p && p.length >= 2; })
      .map(function (p) {
        var x = parseFloat(p[0]), y = clamp01(p[1]);
        if (!isFinite(x)) x = 0;
        if (x < 0) x = 0;
        if (x > fin) x = fin;
        return [x, y];
      })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!pts.length) return [];

    var limpios = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i][0] - limpios[limpios.length - 1][0]) < 1e-6)
        limpios[limpios.length - 1] = pts[i];
      else
        limpios.push(pts[i]);
    }
    pts = limpios;

    if (pts.length === 1)
      return [[t0, pts[0][1]], [t1 - eps, pts[0][1]]];

    if (pts[0][0] > 1e-6) pts.unshift([0, pts[0][1]]);
    if (fin - pts[pts.length - 1][0] > 1e-6) pts.push([fin, pts[pts.length - 1][1]]);

    return pts.map(function (p) { return [t0 + p[0], p[1]]; });
  }

  // Devuelve [inicio, fin] del bloque XML del track que se llama `name`
  function trackBlock(xml, name) {
    var re = /<(AudioTrack|MidiTrack)\b[^>]*>/g, m;
    while ((m = re.exec(xml))) {
      var start = m.index;
      var close = '</' + m[1] + '>';
      var end = xml.indexOf(close, start);
      if (end < 0) continue;
      var blk = xml.slice(start, end);
      var nm = /<EffectiveName Value="([^"]*)"/.exec(blk);
      if (nm && nm[1] === name) return [start, end];
    }
    return null;
  }

  // Las pistas que llevan clips. Cada una trae su Id —que Live garantiza unico— y el Id
  // del grupo que la contiene, o -1 si esta suelta.
  //
  // El Id importa porque el NOMBRE no alcanza: un Set con dos decks tiene dos pistas
  // llamadas ACID, y todo lo que se indexe por nombre las colapsa en una.
  function trackNames(xml) {
    return listaTracks(xml)
      .filter(function (t) { return t.tipo === 'AudioTrack' || t.tipo === 'MidiTrack' || t.tipo === 'ReturnTrack'; })
      .map(function (t) {
        return { name: t.nombre, type: t.tipo, id: t.id, grupo: t.grupo };
      });
  }

  // Los GroupTrack, que no llevan clips —un grupo es una suma— pero dan la jerarquia.
  // Devuelve { id: { name, padre } } para poder armar la ruta de una pista hacia arriba.
  function gruposDe(xml) {
    var out = {}, re = /<GroupTrack\b([^>]*)>/g, m;
    while ((m = re.exec(xml))) {
      var end = xml.indexOf('</GroupTrack>', m.index);
      var blk = xml.slice(m.index, end);
      var nm = /<EffectiveName Value="([^"]*)"/.exec(blk);
      var id = /\bId="(\d+)"/.exec(m[1]);
      var gid = /<TrackGroupId Value="(-?\d+)"/.exec(blk);
      var ci = /<Color Value="(-?\d+)"\s*\/>/.exec(blk);
      if (id) out[id[1]] = {
        name: nm ? nm[1] : id[1],
        padre: gid ? gid[1] : '-1',
        colorIndice: ci ? +ci[1] : null
      };
    }
    return out;
  }

  // La ruta de grupos de una pista, de afuera hacia adentro: ['DECK1', 'ACIDLEAD'].
  // Vacia si la pista no esta agrupada. Corta si los grupos se referencian en circulo,
  // que no deberia pasar pero un archivo roto no tiene por que colgar la pagina.
  function rutaDeGrupo(grupos, idGrupo) {
    var ruta = [], visto = {}, g = String(idGrupo);
    while (g && g !== '-1' && grupos[g] && !visto[g]) {
      visto[g] = 1;
      ruta.unshift(grupos[g].name);
      g = grupos[g].padre;
    }
    return ruta;
  }

  // El bloque de una pista por su Id. trackBlock() busca por nombre y devuelve la
  // PRIMERA que coincide, que es justamente lo que rompe con nombres repetidos.
  function trackBlockById(xml, id) {
    var lista = listaTracks(xml);
    for (var i = 0; i < lista.length; i++)
      if (lista[i].id === String(id)) return [lista[i].ini, lista[i].fin];
    return null;
  }

  // param: 'Volume', 'Pan' o 'SendA'/'SendB'/'SendC' (los envios del mixer)
  function automationTargetId(block, param) {
    var send = /^Send([A-Z])$/.exec(param);
    if (send) {
      var idx = send[1].charCodeAt(0) - 65;   // A=0, B=1, C=2
      var holders = block.match(/<TrackSendHolder\b[^>]*>[\s\S]*?<\/TrackSendHolder>/g) || [];
      if (idx >= holders.length) return null;
      var at = /<AutomationTarget Id="(\d+)"/.exec(holders[idx]);
      return at ? at[1] : null;
    }
    var m = new RegExp('<' + param + '>[\\s\\S]{0,800}?</' + param + '>').exec(block);
    if (!m) return null;
    var at = /<AutomationTarget Id="(\d+)"/.exec(m[0]);
    return at ? at[1] : null;
  }

  // ---------------------------------------------------------------- rango y base
  // El NODO XML de un parametro del mixer. Devuelve el pedazo de bloque donde viven su
  // <Manual>, su <MidiControllerRange> y su <AutomationTarget>, que es de donde sale todo
  // lo que hace falta saber para automatizarlo.
  function nodoDeParam(block, param) {
    // Un parametro de un device viene con la clave dev:<indice>:<Clase>:<ruta>, donde la
    // ruta puede tener varios tramos separados por barra, porque Live los anida distinto
    // segun el device: 'Drive' en un Saturator, pero 'Bands.0/ParameterA/Freq' en un EQ.
    //
    // La clase va ademas del indice a proposito: si moviste los devices en Live, el indice
    // apunta a otro y escribir ahi seria automatizar el parametro equivocado sin que nadie
    // se entere. Preferimos que no encuentre nada.
    var dev = /^dev:(\d+):([A-Za-z][\w.]*):(.+)$/.exec(param);
    if (dev) {
      var lista = devicesDeTrack(block);
      var d = lista[+dev[1]];
      if (!d || d.clase !== dev[2]) return null;
      // se camina la ruta tramo por tramo. Buscar el tag suelto no sirve: el <Freq> de la
      // banda 3 y el de la banda 0 se escriben igual, y el indexOf devuelve siempre el
      // primero.
      var nodo = d.xml, partes = dev[3].split('/');
      for (var k = 0; k < partes.length; k++) {
        var hh = hijosDirectos(nodo), hallado = null;
        for (var q = 0; q < hh.length; q++) {
          if (!hh[q].solo && hh[q].nombre === partes[k]) { hallado = hh[q].xml; break; }
        }
        if (!hallado) return null;
        nodo = hallado;
      }
      return nodo;
    }

    var send = /^Send([A-Z])$/.exec(param);
    if (send) {
      var idx = send[1].charCodeAt(0) - 65;   // A=0, B=1, C=2
      var holders = block.match(/<TrackSendHolder\b[^>]*>[\s\S]*?<\/TrackSendHolder>/g) || [];
      return idx < holders.length ? holders[idx] : null;
    }
    // Sin regex: el nombre del parametro se concatena, y una RegExp construida con
    // strings obliga a escapar las clases dos veces. Con indexOf no hay nada que escapar.
    var abre = "<" + param + ">", cierra = "</" + param + ">";
    var i = block.indexOf(abre);
    if (i < 0) return null;
    var j = block.indexOf(cierra, i);
    if (j < 0 || j - i > 900) return null;   // no es el nodo del parametro, es otra cosa
    return block.slice(i, j + cierra.length);
  }

  // Todo lo que hace falta saber de un parametro para escribirle una envolvente.
  //
  // POR QUE EXISTE. Las formas viven en 0..1, pero los parametros de Live NO. El Pan va de
  // -1 a 1 con el centro en 0, un Drive de un Saturator va de 0 a 1, y un PreDrive va de
  // -36 a 36. Escribir el 0..1 crudo en cualquiera de esos es escribir otra cosa:
  // una envolvente de Pan con una seccion "sin forma" terminaba con Value="1", o sea el
  // canal tirado del todo a la derecha, en las secciones que el usuario ni toco.
  //
  //   base  — el valor que el parametro tiene HOY puesto a mano en el Set. Es a donde
  //           tiene que volver una seccion sin forma: la envolvente afecta donde la
  //           dibujaste y en el resto deja el parametro como estaba.
  //   min/max — el rango real, sacado de <MidiControllerRange>. Si el parametro no lo
  //           declara se asume 0..1, que es lo que usan casi todos los normalizados.
  //   escala — 'fader' solo para Volume. Ahi el 1 de las formas NO es el maximo del
  //           parametro sino TU nivel de mezcla, y por eso se multiplica por la base en
  //           vez de interpolar el rango. Es la regla que ya existia y no cambia.
  //   tipo  — 'float', 'bool' o 'enum'. Un <Manual Value="true"> es un boton, no un fader,
  //           y su envolvente no se escribe con <FloatEvent>.
  //
  // OJO CON EL VOLUMEN: el Manual de <Volume> es AMPLITUD LINEAL, no el 0..1 del fader.
  // Medido sobre TRACK1.als: HH esta en 0.5011872 y eso es exactamente -6 dB
  // (10^(-6/20)), KICK en 0.6309573 que es -4 dB, y el maximo del rango es 1.99526238,
  // que es +6 dB. O sea que 1 es 0 dB, NO +6 dB como decia la nota vieja del handoff.
  // No cambia el codigo -siempre se escala contra el valor actual- pero cambia lo que
  // significa un flat:0.5: es la mitad de la amplitud, unos 6 dB abajo de tu nivel.
  function paramInfo(block, param) {
    var nodo = nodoDeParam(block, param);
    if (!nodo) return null;
    var at = /<AutomationTarget Id="(\d+)"/.exec(nodo);
    if (!at) return null;

    var man = /<Manual Value="([^"]*)"/.exec(nodo);
    var crudo = man ? man[1] : null;
    var tipo = 'float';
    if (crudo === 'true' || crudo === 'false') tipo = 'bool';

    var mr = /<MidiControllerRange>\s*<Min Value="([^"]*)"\s*\/>\s*<Max Value="([^"]*)"/.exec(nodo);
    var min = mr ? parseFloat(mr[1]) : 0, max = mr ? parseFloat(mr[2]) : 1;
    // Sin rango declarado y con un Manual entero, es un enum (el Type de un Saturator).
    if (!mr && tipo === 'float' && crudo !== null && /^-?\d+$/.test(crudo)) tipo = 'enum';

    var base = tipo === 'bool' ? (crudo === 'true') : parseFloat(crudo);
    if (tipo !== 'bool' && !isFinite(base)) base = min;

    var escala = (param === 'Volume') ? 'fader' : 'rango';   // solo el del mixer: un dev: nunca entra aca
    // El fader se mide contra si mismo: el 1 de las formas es el nivel actual del canal.
    if (escala === 'fader') { min = 0; max = (base > 0) ? base : 1; }

    return { pid: at[1], base: base, min: min, max: max, tipo: tipo, escala: escala, param: param };
  }

  // 0..1 (el espacio de las formas) -> unidades del parametro.
  function aUnidades(info, v) {
    if (info.escala === 'fader') return v * info.max;
    return info.min + v * (info.max - info.min);
  }

  // Unidades del parametro -> 0..1. Es la inversa exacta de aUnidades(), y hace falta
  // para LEER una envolvente que ya esta en el archivo: los FloatEvent vienen en
  // unidades del parametro, y el catalogo de formas compara en 0..1.
  function deUnidades(info, u) {
    if (info.escala === 'fader') return info.max ? u / info.max : 0;
    if (info.max === info.min) return 0;
    return (u - info.min) / (info.max - info.min);
  }

  // Y la vuelta: el valor base del parametro, expresado en el 0..1 de las formas. Es lo
  // que se le pone a una seccion vacia para que "no hacer nada" signifique de verdad
  // dejar el parametro donde estaba.
  //
  //   Volume -> 1     (el 1 de las formas YA es tu nivel: identico a lo que hacia antes)
  //   Pan    -> 0.5   (base 0 en un rango -1..1: el centro)
  //   Send   -> 0     (base 0 en un rango 0..1: sin envio)
  function baseEnFormas(info) {
    if (info.escala === 'fader') return 1;
    if (info.max === info.min) return 0;
    var v = (info.base - info.min) / (info.max - info.min);
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  // ---------------------------------------------------------------- devices del canal
  //
  // Automatizar el Drive de un Saturator o el Feedback de un Delay, no solo el mixer.
  //
  // COMO SE RECONOCE UN PARAMETRO. Live no los marca de ninguna forma especial: un
  // parametro es un nodo que tiene <LomId>, un <Manual> con el valor puesto a mano, y un
  // <AutomationTarget> con el Id contra el que se escribe la envolvente:
  //
  //   <Drive>
  //     <LomId Value="0" />
  //     <Manual Value="1" />
  //     <MidiControllerRange><Min Value="0" /><Max Value="1" /></MidiControllerRange>
  //     <AutomationTarget Id="25072"><LockEnvelope Value="0" /></AutomationTarget>
  //   </Drive>
  //
  // Eso alcanza, y sirve para cualquier device: los de fabrica, los de terceros y los que
  // no conocemos. No hay una lista de parametros escrita a mano en ningun lado.
  //
  // EL RANGO IMPORTA MAS QUE NUNCA ACA. En el mixer los rangos son pocos y conocidos; en
  // un device cambian de un parametro al de al lado. Medido sobre el Saturator del ACID de
  // TRACK1.als: Drive va de 0 a 1, PreDrive de -36 a 36 y ColorFrequency de 30 a 18500.
  // Escribir el 0..1 de las formas crudo en el segundo seria escribir cualquier cosa; por
  // eso todo pasa por paramInfo(), que ya sabe traducir.

  // Nombres de los devices de fabrica que no se leen desde el nombre de la clase. Los que
  // no estan en la tabla se parten por mayusculas, que da algo razonable: AutoFilter queda
  // como Auto Filter. No es una lista que haya que completar, es para que los mas usados
  // se vean como en Live.
  var NOMBRES_DEVICE = {
    Eq8: 'EQ Eight', FilterEQ3: 'EQ Three', Compressor2: 'Compressor',
    StereoGain: 'Utility', Redux2: 'Redux', Chorus2: 'Chorus-Ensemble',
    CrossDelay: 'Simple Delay', Vinyl: 'Vinyl Distortion', LimiterDevice: 'Limiter',
    UltraAnalog: 'Analog', InstrumentVector: 'Wavetable', OriginalSimpler: 'Simpler',
    MultiSampler: 'Sampler', InstrumentImpulse: 'Impulse',
    AudioEffectGroupDevice: 'Audio Effect Rack', MidiEffectGroupDevice: 'MIDI Effect Rack',
    InstrumentGroupDevice: 'Instrument Rack', DrumGroupDevice: 'Drum Rack'
  };

  // Parametros cuyo nombre de clase no se lee solo.
  var NOMBRES_PARAM = { DryWet: 'Dry/Wet', On: 'Device On' };

  function porMayusculas(s) {
    return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  }
  function nombreDeDevice(clase, userName) {
    if (userName) return userName;
    return NOMBRES_DEVICE[clase] || porMayusculas(clase);
  }
  // Los contenedores numerados de Live se leen mal tal cual: <Bands.0> es la primera banda
  // de un EQ, no "Bands punto cero". Y <ParameterA>/<ParameterB> son los dos canales del
  // modo M/S, que en Live se ven como A y B. Sin esto, la frecuencia de la primera banda
  // se llamaba "Bands.0 - Parameter A - Freq"; ahora es "Band 1 - A - Freq".
  function nombreDeParam(p) {
    if (NOMBRES_PARAM[p]) return NOMBRES_PARAM[p];
    var num = /^([A-Za-z]+)\.(\d+)$/.exec(p);
    if (num) return porMayusculas(num[1].replace(/s$/, "")) + " " + (+num[2] + 1);
    var par = /^Parameter([A-Z])$/.exec(p);
    if (par) return par[1];
    return porMayusculas(p);
  }

  // Los devices que cuelgan DIRECTO de la cadena del canal.
  //
  // Solo el primer nivel, a proposito: adentro de un rack hay otro <Devices> por cadena, y
  // un parametro de ahi adentro necesita saber de que cadena es para poder mostrarse sin
  // mentir. Los racks aparecen en la lista -asi ves que estan- pero por ahora solo con sus
  // parametros de primer nivel, que son los ocho macros.
  function devicesDeTrack(block) {
    var i = block.indexOf('<Devices>');
    if (i < 0) return [];
    var fin = block.indexOf('</Devices>', i);
    if (fin < 0) return [];
    var dentro = block.slice(i + 9, fin);

    // Se camina la lista de tags llevando la cuenta de la profundidad. Un device es un tag
    // que abre a profundidad 0. Con un regex de abre-hasta-cierra no alcanza: un rack tiene
    // adentro otros devices y hasta otro <Devices>, asi que el cierre que corresponde no es
    // el primero que aparece.
    var out = [], prof = 0, ini = -1, clase = null;
    var re = /<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>/g, m;
    while ((m = re.exec(dentro))) {
      var cierra = m[1] === '/', solo = m[4] === '/' || m[3].slice(-1) === '/';
      if (solo) continue;
      if (!cierra) {
        if (prof === 0) { ini = m.index; clase = m[2]; }
        prof++;
      } else {
        prof--;
        if (prof === 0 && ini >= 0) {
          var xml = dentro.slice(ini, m.index + m[0].length);
          var un = /<UserName Value="([^"]*)"/.exec(xml);
          out.push({ clase: clase, indice: out.length,
                     nombre: nombreDeDevice(clase, un ? un[1] : ''),
                     xml: xml, desde: i + 9 + ini, hasta: i + 9 + m.index + m[0].length });
          ini = -1;
        }
        if (prof < 0) break;
      }
    }
    return out;
  }

  // Los nodos hijos DIRECTOS de un bloque XML, incluidos los auto-cerrados.
  //
  // Hace falta caminar los tags llevando la profundidad y no alcanza con un regex de
  // abre-hasta-cierra: adentro de un rack hay otros devices y hasta otro <Devices>, asi
  // que el cierre que corresponde no es el primero que aparece.
  function hijosDirectos(xml) {
    var cuerpo = xml.slice(xml.indexOf(String.fromCharCode(62)) + 1);
    var out = [], prof = 0, ini = -1, nombre = null;
    var re = /<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>/g, m;
    while ((m = re.exec(cuerpo))) {
      var cierra = m[1] === '/';
      var solo = m[4] === '/' || m[3].slice(-1) === '/';
      if (solo) {
        if (prof === 0) out.push({ nombre: m[2], xml: m[0], solo: true });
        continue;
      }
      if (!cierra) {
        if (prof === 0) { ini = m.index; nombre = m[2]; }
        prof++;
      } else {
        prof--;
        if (prof === 0 && ini >= 0) {
          out.push({ nombre: nombre, xml: cuerpo.slice(ini, m.index + m[0].length), solo: false });
          ini = -1;
        }
        if (prof < 0) break;
      }
    }
    return out;
  }

  // Un nodo es un PARAMETRO si tiene <Manual> y <AutomationTarget> como hijos DIRECTOS.
  //
  // Lo de "directos" no es una formalidad: <Bands.0> de un EQ Eight es un contenedor con
  // cuatro parametros adentro, y mirando el nodo entero tambien encuentra un <Manual> y un
  // <AutomationTarget>. Sin este chequeo, la banda entera se listaba como si fuera un
  // parametro solo, con el rango de la frecuencia y el tipo del boton de encendido: dos
  // datos de dos cosas distintas pegados.
  function datosDeParametro(nodo) {
    var hh = hijosDirectos(nodo);
    var man = null, at = null, rango = null;
    for (var i = 0; i < hh.length; i++) {
      if (hh[i].nombre === 'Manual') man = /Value="([^"]*)"/.exec(hh[i].xml);
      else if (hh[i].nombre === 'AutomationTarget') at = /Id="(\d+)"/.exec(hh[i].xml);
      else if (hh[i].nombre === 'MidiControllerRange') rango = hh[i].xml;
    }
    if (!man || !at) return null;
    var mr = rango ? /<Min Value="([^"]*)"\s*\/>\s*<Max Value="([^"]*)"/.exec(rango) : null;
    var crudo = man[1], tipo = 'float';
    if (crudo === 'true' || crudo === 'false') tipo = 'bool';
    else if (!mr && /^-?\d+$/.test(crudo)) tipo = 'enum';
    return { tipo: tipo, target: at[1],
             min: mr ? parseFloat(mr[1]) : 0,
             max: mr ? parseFloat(mr[2]) : 1,
             base: tipo === 'bool' ? (crudo === 'true') : parseFloat(crudo) };
  }

  // Los parametros automatizables de un device.
  //
  // Se baja recursivamente, con tope, porque Live los anida a profundidades distintas
  // segun el device. Medido sobre TRACK1.als:
  //
  //   Saturator  Drive .................. nivel 1
  //   Saturator  WaveShaper > Drive ..... nivel 2
  //   EQ Eight   Bands.0 > ParameterA > Freq ... nivel 3
  //
  // Con tope de 1 nivel no aparece la frecuencia de una banda del EQ, que es justamente la
  // que uno quiere barrer. Con tope de 3 aparecen las tres.
  //
  // NO SE BAJA A UN RACK. <Devices>, <Branches> y <DeviceChain> son la puerta a los
  // sub-devices de un rack, y un parametro de ahi adentro necesita decir de que cadena es
  // para no mentir. Un rack aparece en la lista con sus macros, que son de primer nivel,
  // y nada mas.
  var PROF_PARAMS = 3;
  var NO_BAJAR = { Devices: 1, Branches: 1, DeviceChain: 1, BranchDeviceChain: 1 };

  function recolectarParams(nodo, ruta, prof, out) {
    hijosDirectos(nodo).forEach(function (h) {
      if (h.solo || NO_BAJAR[h.nombre]) return;
      var r = ruta.concat([h.nombre]);
      var d = datosDeParametro(h.xml);
      if (d) {
        out.push({ clave: r.join('/'),
                   nombre: r.map(nombreDeParam).join(' ' + String.fromCharCode(183) + ' '),
                   tipo: d.tipo, target: d.target, min: d.min, max: d.max, base: d.base });
        return;
      }
      if (prof > 1) recolectarParams(h.xml, r, prof - 1, out);
    });
  }

  function paramsDeDevice(devXml) {
    var out = [];
    recolectarParams(devXml, [], PROF_PARAMS, out);
    return out;
  }

  // El catalogo entero de lo que se le puede automatizar a un canal: el mixer primero
  // -que es lo que se usa casi siempre- y despues un grupo por device.
  //
  // La CLAVE de un parametro de device es dev:<indice>:<Clase>:<Param>. Lleva la clase
  // ademas del indice a proposito: si moves los devices en Live, el indice apunta a otro
  // device y la clave deja de coincidir. Preferimos que avise a que escriba la envolvente
  // en el parametro equivocado.
  function paramsDeCanal(xml, track) {
    var pos = bloqueDePista(xml, track);
    if (!pos) return null;
    var block = xml.slice(pos[0], pos[1]);

    var mixer = [];
    ['Volume', 'Pan', 'Speaker'].forEach(function (p) {
      var info = paramInfo(block, p);
      if (info) mixer.push({ clave: p, nombre: p, tipo: info.tipo });
    });
    var envios = (block.match(/<TrackSendHolder\b[^>]*>/g) || []).length;
    for (var s = 0; s < envios && s < 12; s++) {
      var letra = String.fromCharCode(65 + s);
      mixer.push({ clave: 'Send' + letra, nombre: 'Send ' + letra, tipo: 'float' });
    }

    var devs = devicesDeTrack(block).map(function (d) {
      return { clase: d.clase, indice: d.indice, nombre: d.nombre,
               params: paramsDeDevice(d.xml).map(function (p) {
                 return { clave: 'dev:' + d.indice + ':' + d.clase + ':' + p.clave,
                          nombre: p.nombre, tipo: p.tipo, min: p.min, max: p.max, base: p.base };
               }) };
    });
    return { mixer: mixer, devices: devs };
  }


  // cuántos envíos tiene el canal (para poblar el selector de parámetro)
  function sendCount(xml, trackName) {
    var pos = bloqueDePista(xml, trackName);
    if (!pos) return 0;
    var blk = xml.slice(pos[0], pos[1]);
    return (blk.match(/<TrackSendHolder\b[^>]*>/g) || []).length;
  }

  // El volumen que el canal tiene puesto en el mixer. En Live el fader normalizado va de
  // 0 (-inf) a 1 (+6 dB), y 0 dB cae cerca de 0.85: casi ningun canal esta en 1.
  function volumenDelTrack(block) {
    var m = /<Volume>[\s\S]{0,600}?<Manual Value="([\d.]+)"/.exec(block);
    return m ? parseFloat(m[1]) : null;
  }

  // secs: [{name,bars}] · shapes: [string] (se repiten si faltan)
  // Para Volume, las formas se escalan al nivel que el canal YA tiene: "al maximo" es tu
  // nivel de mezcla, no +6 dB. Si no, cualquier envolvente de volumen subiria el canal por
  // encima de como lo dejaste. Pan y los Sends no se escalan: ahi 0..1 es el rango real.
  // `track` puede ser el Id de la pista o su nombre.
  //
  // Por Id importa: con grupos hay dos pistas llamadas ACID, y buscar por nombre devuelve
  // siempre la primera. Una envolvente puesta en el ACID del segundo deck se escribia en
  // el del primero. Se probo primero por Id y despues por nombre, asi que una pista que
  // se llame «808» tampoco se confunde.
  function bloqueDePista(xml, track) {
    var k = String(track);
    if (/^\d+$/.test(k)) {
      var porId = trackBlockById(xml, k);
      if (porId) return porId;
    }
    return trackBlock(xml, k);
  }

  function setEnvelope(xml, trackName, param, secs, shapes, beatsPerBar) {
    var pos = bloqueDePista(xml, trackName);
    if (!pos) throw new Error('No encontre el canal "' + trackName + '"');
    var block = xml.slice(pos[0], pos[1]);

    var info = paramInfo(block, param);
    if (!info) throw new Error('El canal ' + trackName + ' no tiene parametro ' + param);
    var pid = info.pid;
    if (info.tipo === 'bool') {
      if (param !== 'Speaker') {
        throw new Error('El parametro ' + param + ' es de tipo bool y todavia no se escribe');
      }
      return setBoolEnvelope(xml, pos, block, trackName, param, info, secs, shapes, beatsPerBar);
    }
    if (info.tipo !== 'float') {
      throw new Error('El parametro ' + param + ' es de tipo ' + info.tipo +
                      ' y todavia no se escribe con FloatEvent');
    }
    var techo = (info.escala === 'fader') ? info.max : 1;

    // El valor base del parametro, en el 0..1 de las formas. Una seccion SIN forma se
    // escribe con ese valor: la envolvente toma efecto donde la dibujaste y en el resto
    // deja el parametro como estaba. Antes se rellenaba con flat:1 desde la interfaz, que
    // para el volumen daba justo -tu nivel- pero para el Pan escribia el canal tirado
    // del todo a la derecha y para un Send lo mandaba al maximo.
    var base01 = baseEnFormas(info);

    var soloShapes = Array.isArray(shapes) ? shapes : ((shapes && shapes.shapes) || []);
    var pointSections = (!Array.isArray(shapes) && shapes && shapes.points) ? shapes.points : null;

    var pts = [], beat = 0, plan = [], ultimo = null;
    for (var i = 0; i < secs.length; i++) {
      var t0 = beat, t1 = beat + secs[i].bars * beatsPerBar;
      var sh = soloShapes.length ? (soloShapes[i % soloShapes.length] || '') : '';
      var local = pointSections && pointSections[i] && pointSections[i].length ? pointSections[i] : null;
      var efectiva = sh || ('flat:' + base01);
      var p = local ? drawPoints(local, t0, t1) : shapePoints(efectiva, t0, t1, ultimo);
      // el valor con que termina la seccion, SIN mapear: es el espacio 0..1 en que
      // trabajan las formas, y es lo que la siguiente va a usar si quiere continuar.
      // El trazo libre ya viene explicitado: no continua "por forma", sino por su ultimo
      // punto real.
      ultimo = p[p.length - 1][1];
      p = p.map(function (q) { return [q[0], aUnidades(info, q[1])]; });
      pts = pts.concat(p);
      plan.push({ name: secs[i].name, shape: sh, from: t0, to: t1, points: p.length,
                  base: !local && !sh, manual: !!local });
      beat = t1;
    }

    var id = maxId(xml) + 1;
    var ev = ['<FloatEvent Id="' + (id++) + '" Time="-63072000" Value="' + round6(pts[0][1]) + '" />'];
    for (var k = 0; k < pts.length; k++) {
      ev.push('<FloatEvent Id="' + (id++) + '" Time="' + round6(pts[k][0]) + '" Value="' + round6(pts[k][1]) + '" />');
    }
    var env = '<AutomationEnvelope Id="' + (id++) + '">' +
      '<EnvelopeTarget><PointeeId Value="' + pid + '" /></EnvelopeTarget>' +
      '<Automation><Events>' + ev.join('') + '</Events>' +
      '<AutomationTransformViewState><IsTransformPending Value="false" />' +
      '<TimeAndValueTransforms /></AutomationTransformViewState></Automation>' +
      '</AutomationEnvelope>';

    // El canal puede tener el contenedor vacío (<Envelopes />) o ya con envolventes:
    // en el segundo caso se agrega antes del cierre, para poder mover varias cosas a la vez.
    var vacio = /<AutomationEnvelopes>\s*<Envelopes\s*\/>\s*<\/AutomationEnvelopes>/;
    var lleno = /(<AutomationEnvelopes>\s*<Envelopes>)([\s\S]*?)(<\/Envelopes>\s*<\/AutomationEnvelopes>)/;
    var nuevo, reemplazadas = 0;
    if (vacio.test(block)) {
      nuevo = block.replace(vacio, '<AutomationEnvelopes><Envelopes>' + env + '</Envelopes></AutomationEnvelopes>');
    } else if (lleno.test(block)) {
      nuevo = block.replace(lleno, function (all, open, body, close) {
        // Si el canal YA tiene una envolvente de este mismo parámetro, se reemplaza en vez
        // de agregar otra al lado: dos apuntando al mismo PointeeId es un Set inconsistente,
        // y ademas se perdería de vista la que ya estaba.
        var limpio = body.replace(/<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g, function (bloque) {
          var p = /<PointeeId Value="(\d+)"/.exec(bloque);
          if (p && p[1] === pid) { reemplazadas++; return ''; }
          return bloque;
        });
        return open + limpio + env + close;
      });
    } else {
      throw new Error('El canal ' + trackName + ' no tiene contenedor de envolventes');
    }

    var out = xml.slice(0, pos[0]) + nuevo + xml.slice(pos[1]);
    return { xml: fixNextPointeeId(out), plan: plan, points: pts.length, pointee: pid,
             reemplazadas: reemplazadas, techo: techo,
             rango: [info.min, info.max], base: info.base, tipo: info.tipo };
  }

  // Los interruptores de Live no tienen valores intermedios: cada sección resuelve a
  // true/false y se escribe con BoolEvent. Un null conserva el estado manual del canal.
  function setBoolEnvelope(xml, pos, block, trackName, param, info, secs, estados, beatsPerBar) {
    var elegidos = estados && !Array.isArray(estados) ? (estados.bools || []) : [];
    var valores = [], beat = 0;
    for (var i = 0; i < secs.length; i++) {
      var puesto = elegidos[i];
      var valor = (puesto === true || puesto === false) ? puesto : info.base;
      valores.push([beat, valor]);
      beat += secs[i].bars * beatsPerBar;
    }
    if (!valores.length) throw new Error('No hay secciones para automatizar ' + param);

    var id = maxId(xml) + 1;
    var ev = ['<BoolEvent Id="' + (id++) + '" Time="-63072000" Value="' + valores[0][1] + '" />'];
    valores.forEach(function (p) {
      ev.push('<BoolEvent Id="' + (id++) + '" Time="' + round6(p[0]) + '" Value="' + p[1] + '" />');
    });
    var env = '<AutomationEnvelope Id="' + (id++) + '">' +
      '<EnvelopeTarget><PointeeId Value="' + info.pid + '" /></EnvelopeTarget>' +
      '<Automation><Events>' + ev.join('') + '</Events>' +
      '<AutomationTransformViewState><IsTransformPending Value="false" />' +
      '<TimeAndValueTransforms /></AutomationTransformViewState></Automation>' +
      '</AutomationEnvelope>';

    var vacio = /<AutomationEnvelopes>\s*<Envelopes\s*\/>\s*<\/AutomationEnvelopes>/;
    var lleno = /(<AutomationEnvelopes>\s*<Envelopes>)([\s\S]*?)(<\/Envelopes>\s*<\/AutomationEnvelopes>)/;
    var nuevo, reemplazadas = 0;
    if (vacio.test(block)) {
      nuevo = block.replace(vacio, '<AutomationEnvelopes><Envelopes>' + env + '</Envelopes></AutomationEnvelopes>');
    } else if (lleno.test(block)) {
      nuevo = block.replace(lleno, function (all, open, body, close) {
        var limpio = body.replace(/<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g, function (bloque) {
          var p = /<PointeeId Value="(\d+)"/.exec(bloque);
          if (p && p[1] === info.pid) { reemplazadas++; return ''; }
          return bloque;
        });
        return open + limpio + env + close;
      });
    } else {
      throw new Error('El canal ' + trackName + ' no tiene contenedor de envolventes');
    }
    var out = xml.slice(0, pos[0]) + nuevo + xml.slice(pos[1]);
    return { xml: fixNextPointeeId(out), points: valores.length, pointee: info.pid,
             reemplazadas: reemplazadas, base: info.base, tipo: info.tipo };
  }

  function round6(n) { return String(Math.round(n * 1e6) / 1e6); }

  // Las automatizaciones que el .als YA tiene en un canal.
  //
  // Devuelve el PointeeId, cuántos puntos tiene, y —cuando se puede— a qué parámetro
  // apunta. El PointeeId solo no dice nada: hay que cotejarlo contra los destinos del
  // mixer del canal para saber si es el volumen, el pan o un envío.
  //
  // Se usa para avisar antes de pisar algo que el usuario dibujó a mano en Live: escribir
  // una automatización sobre el mismo parámetro reemplaza la que había.
  var PARAMS_MIXER = ['Volume', 'Pan', 'SendA', 'SendB', 'SendC', 'Speaker'];

  function readEnvelopes(xml, trackName) {
    var pos = bloqueDePista(xml, trackName);
    if (!pos) return [];
    var blk = xml.slice(pos[0], pos[1]);

    // de qué parámetro es cada PointeeId de este canal
    var deQuien = {};
    PARAMS_MIXER.forEach(function (p) {
      var id = automationTargetId(blk, p);
      if (id) deQuien[id] = p;
    });
    // y los de los devices de la cadena, que antes quedaban en null. Sin esto, abrir un
    // Set con una envolvente de device la mostraba como "no se sabe leer" y al generar el
    // .als se perdia: no se leia, no se dibujaba, y no se volvia a escribir.
    devicesDeTrack(blk).forEach(function (d) {
      paramsDeDevice(d.xml).forEach(function (p) {
        if (!deQuien[p.target]) deQuien[p.target] = "dev:" + d.indice + ":" + d.clase + ":" + p.clave;
      });
    });

    var out = [], m, re = /<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g;
    while ((m = re.exec(blk))) {
      var pid = /<PointeeId Value="(\d+)"/.exec(m[0]);
      var evs = m[0].match(/<FloatEvent /g) || [];
      var id = pid ? pid[1] : '?';
      out.push({
        track: trackName,
        pointee: id,
        events: evs.length,
        // null solo si el destino no se pudo identificar: no es del mixer ni de ningun
        // device de primer nivel (uno adentro de un rack, por ejemplo)
        param: deQuien[id] || null
      });
    }
    return out;
  }

  // Todas las del archivo, de todos los canales
  function readAllEnvelopes(xml) {
    var out = [];
    // se recorre por Id: con dos pistas del mismo nombre, ir por nombre leia dos veces la
    // primera y nunca la segunda
    trackNames(xml).forEach(function (t) {
      readEnvelopes(xml, t.id || t.name).forEach(function (e) {
        e.trackId = t.id || null;         // de que pista salio, mas alla del nombre
        out.push(e);
      });
    });
    return out;
  }

  // ------------------------------------------------------- volver a leer una envolvente
  //
  // Los puntos de una envolvente: [[beat, valor], ...], en el espacio 0..1 del parametro.
  // El primer punto va en Time="-63072000", que es el valor de arranque antes del compas
  // 1 y no una posicion real: se saltea.
  //
  // Para Volume los valores estan escalados al fader del canal, asi que se dividen por el
  // para volver al 0..1 con el que trabajan las formas.
  function puntosDeEnvolvente(xml, trackName, param) {
    var pos = bloqueDePista(xml, trackName);
    if (!pos) return null;
    var blk = xml.slice(pos[0], pos[1]);
    var info = paramInfo(blk, param);
    if (!info) return null;
    var pid = info.pid;

    var m, re = /<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g, env = null;
    while ((m = re.exec(blk))) {
      var p = /<PointeeId Value="(\d+)"/.exec(m[0]);
      if (p && p[1] === pid) { env = m[0]; break; }
    }
    if (!env) return null;

    // Los puntos vuelven al 0..1 de las formas con la MISMA regla con que se escribieron:
    // el fader para el volumen, el rango real del parametro para todo lo demas.
    var pts = [], mm, rp = /<FloatEvent\b[^>]*\sTime="([-\d.eE+]+)"[^>]*\sValue="([-\d.eE+]+)"/g;
    while ((mm = rp.exec(env))) {
      var t = parseFloat(mm[1]);
      if (t < -1000) continue;                 // el valor inicial, no es una posicion
      pts.push([t, deUnidades(info, parseFloat(mm[2]))]);
    }
    return pts;
  }

  function boolsDeEnvolvente(xml, trackName, param, secs, beatsPerBar) {
    var pos = bloqueDePista(xml, trackName);
    if (!pos) return null;
    var blk = xml.slice(pos[0], pos[1]);
    var info = paramInfo(blk, param);
    if (!info || info.tipo !== 'bool') return null;
    var env = null, m, re = /<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g;
    while ((m = re.exec(blk))) {
      var p = /<PointeeId Value="(\d+)"/.exec(m[0]);
      if (p && p[1] === info.pid) { env = m[0]; break; }
    }
    if (!env) return null;

    var eventos = [], mm, rp = /<BoolEvent\b[^>]*\sTime="([-\d.eE+]+)"[^>]*\sValue="(true|false)"/g;
    while ((mm = rp.exec(env))) eventos.push([parseFloat(mm[1]), mm[2] === 'true']);
    if (!eventos.length) return null;
    eventos.sort(function (a, b) { return a[0] - b[0]; });
    var out = [], beat = 0, ei = 0, actual = info.base;
    secs.forEach(function (s) {
      while (ei < eventos.length && eventos[ei][0] <= beat + 1e-9) actual = eventos[ei++][1];
      out.push(actual);
      beat += s.bars * beatsPerBar;
    });
    return out;
  }

  // De los puntos de una seccion, ¿que forma del catalogo se le parece mas?
  //
  // Esto se apoya en que las envolventes que se leen las escribio esta misma herramienta,
  // asi que los puntos caen donde las formas los ponen. Si alguien dibujo la curva a mano
  // en Live, lo que sale es una aproximacion: se queda con la forma mas parecida.
  var FORMAS = ['flat:0', 'flat:0.5', 'flat:0.8', 'flat:1',
                'up:0-1', 'up:0.1-1', 'down:0-1', 'down:0.1-1',
                'dip:0-1', 'dip:0.3-1', 'saw:0-1:4', 'saw:0-1:8'];

  function formaDeSeccion(pts, t0, t1) {
    // Los dos limites son ESTRICTOS, sin tolerancia, y no es un detalle.
    //
    // Una forma pone su primer punto justo en t0 y el ultimo en t1 - 0.001. O sea que el
    // punto de cierre de la seccion anterior cae a 0.001 de este t0, y el de esta cae a
    // 0.001 del t1 de la que sigue. Cualquier tolerancia mas grande que eso mete el punto
    // del vecino adentro, y la curva parece otra: una seccion plana en 0.5 precedida de
    // una plana en 0 se lee como si arrancara en 0 y saltara, y no se reconoce ninguna.
    var dentro = pts.filter(function (p) { return p[0] >= t0 && p[0] < t1; });
    if (!dentro.length) return '';

    // se compara contra cada forma del catalogo generando sus puntos y midiendo la
    // diferencia. Gana la que menos se aleja.
    var mejor = '', mejorErr = Infinity;
    FORMAS.forEach(function (f) {
      var teoricos;
      try { teoricos = shapePoints(f, t0, t1); } catch (e) { return; }
      // error: para cada punto real, cuanto se aleja de la recta teorica en ese beat
      var err = 0;
      dentro.forEach(function (p) {
        err += Math.abs(p[1] - valorEn(teoricos, p[0]));
      });
      err /= dentro.length;
      // y al reves, para que una forma con muchos puntos no gane solo por tener mas
      teoricos.forEach(function (q) {
        err += Math.abs(q[1] - valorEn(dentro, q[0])) / teoricos.length;
      });
      if (err < mejorErr) { mejorErr = err; mejor = f; }
    });
    // si ni la mejor se parece, mejor no inventar
    return mejorErr <= 0.12 ? mejor : '';
  }

  // el valor de una curva en un beat, interpolando entre los puntos que la definen
  function valorEn(pts, beat) {
    if (!pts.length) return 0;
    if (beat <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (beat <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        var d = b[0] - a[0];
        if (d <= 0) return b[1];
        return a[1] + (b[1] - a[1]) * (beat - a[0]) / d;
      }
    }
    return pts[pts.length - 1][1];
  }

  // Una envolvente del archivo, traida al modelo de la herramienta: una forma por seccion.
  // Devuelve null si no se puede leer.
  function envolventeComoFormas(xml, trackName, param, secs, beatsPerBar) {
    var pos = bloqueDePista(xml, trackName);
    if (!pos) return null;
    var info = paramInfo(xml.slice(pos[0], pos[1]), param);
    if (info && info.tipo === 'bool') {
      var bools = boolsDeEnvolvente(xml, trackName, param, secs, beatsPerBar || 4);
      return bools ? { track: trackName, param: param, tipo: 'bool', shapes: secs.map(function () { return ''; }),
                       points: secs.map(function () { return null; }), bools: bools, on: true } : null;
    }
    var pts = puntosDeEnvolvente(xml, trackName, param);
    if (!pts || !pts.length) return null;
    var bpb = beatsPerBar || 4;
    var shapes = [], beat = 0;
    secs.forEach(function (s) {
      var t0 = beat, t1 = beat + s.bars * bpb;
      shapes.push(formaDeSeccion(pts, t0, t1));
      beat = t1;
    });
    return { track: trackName, param: param, shapes: shapes, on: true };
  }

  // ---------------------------------------------------------------- revisar el archivo
  //
  // Antes de entregarle un .als a alguien conviene mirarlo, no solo contar lo que se
  // escribio. El riesgo real de esta herramienta es romperle el proyecto a una persona:
  // si el XML queda mal, Live no abre el archivo y no dice por que.
  //
  // Devuelve una lista de problemas: { grave: bool, que: string, detalle: string }.
  // `grave` quiere decir "Live probablemente no lo abra o se comporte mal"; el resto son
  // cosas raras que conviene mirar pero que no rompen.
  //
  // No reemplaza abrir el archivo en Live: es lo barato que se puede hacer antes.
  function revisar(xml) {
    var problemas = [];
    function mal(que, detalle) { problemas.push({ grave: true, que: que, detalle: detalle }); }
    function raro(que, detalle) { problemas.push({ grave: false, que: que, detalle: detalle }); }

    // --- 1. el XML tiene que estar balanceado. Es lo que mas rompe y lo que Live menos
    // perdona: un tag sin cerrar y el archivo no abre.
    var pila = [], re = /<(\/?)([A-Za-z][\w.-]*)([^>]*?)(\/?)>/g, m, roto = null;
    while ((m = re.exec(xml)) !== null) {
      if (m[3].slice(-1) === '/' || m[4] === '/') continue;      // auto-cerrado
      if (m[1] === '/') {
        var esperado = pila.pop();
        if (esperado !== m[2]) { roto = { cierra: m[2], esperaba: esperado, pos: m.index }; break; }
      } else pila.push(m[2]);
    }
    if (roto) {
      mal('el XML no cierra bien',
          'aparece </' + roto.cierra + '> donde se esperaba </' + (roto.esperaba || 'nada') + '>');
    } else if (pila.length) {
      mal('quedaron ' + pila.length + ' tag(s) sin cerrar', pila.slice(-4).join(', '));
    }

    // --- 2. NextPointeeId. Live rechaza el archivo si no supera a todos los ids.
    var npi = /<NextPointeeId Value="(\d+)"/.exec(xml);
    if (!npi) mal('falta NextPointeeId', 'Live lo necesita para abrir el Set');
    else {
      // contra los PointeeId, no contra los Id de nodo: son espacios distintos, y los
      // archivos que escribe el propio Live no superan a los segundos
      var top = maxPointeeId(xml);
      if (+npi[1] <= top) mal('NextPointeeId quedo bajo',
                              npi[1] + ' y el PointeeId mas alto es ' + top);
    }

    // --- 3. la lista de locators tiene que seguir ahi, aunque este vacia
    if (!/<Locators>/.test(xml)) mal('falta la lista de <Locators>', 'se perdio al escribir');

    // --- 4. los clips de cada canal: nada antes del compas 1, nada de largo cero, y
    // nada pisandose. Un clip solapado no rompe el archivo pero suena mal y es un error
    // de la maqueta, no del usuario.
    trackNames(xml).forEach(function (t) {
      var pos = bloqueDePista(xml, t.id || t.name);
      if (!pos) return;
      var blk = xml.slice(pos[0], pos[1]);
      var zona = /<ArrangerAutomation>([\s\S]*?)<\/ArrangerAutomation>/.exec(blk);
      if (!zona) return;

      var clips = [], rc = /<(?:Audio|Midi)Clip\b[^>]*\sTime="([-\d.eE]+)"[\s\S]*?<CurrentStart Value="([-\d.eE]+)"[\s\S]*?<CurrentEnd Value="([-\d.eE]+)"/g, c;
      while ((c = rc.exec(zona[1])) !== null) {
        var ini = parseFloat(c[1]);
        var largo = parseFloat(c[3]) - parseFloat(c[2]);
        clips.push({ ini: ini, fin: ini + largo, largo: largo });
      }
      if (!clips.length) return;

      clips.forEach(function (x) {
        if (x.ini < -1e-9) mal('un clip de ' + t.name + ' empieza antes del compas 1',
                               'beat ' + x.ini);
        if (!(x.largo > 1e-9)) mal('un clip de ' + t.name + ' no dura nada',
                                   'largo ' + x.largo + ' en el beat ' + x.ini);
      });

      clips.sort(function (a, b) { return a.ini - b.ini; });
      for (var i = 1; i < clips.length; i++) {
        if (clips[i].ini < clips[i - 1].fin - 1e-6) {
          raro('dos clips de ' + t.name + ' se pisan',
               'uno termina en el beat ' + Math.round(clips[i - 1].fin) +
               ' y el siguiente arranca en ' + Math.round(clips[i].ini));
          break;                                  // con avisar una vez alcanza
        }
      }
    });

    // --- 5. las envolventes: los puntos tienen que ir en orden creciente de tiempo, o
    // Live dibuja cualquier cosa. El primero es el valor inicial y va muy negativo.
    var envs = xml.match(/<AutomationEnvelope\b[^>]*>[\s\S]*?<\/AutomationEnvelope>/g) || [];
    envs.forEach(function (e, n) {
      var ts = [], rt = /<FloatEvent\b[^>]*\sTime="([-\d.eE]+)"/g, mm;
      while ((mm = rt.exec(e)) !== null) ts.push(parseFloat(mm[1]));
      for (var k = 1; k < ts.length; k++) {
        if (ts[k] < ts[k - 1]) {
          mal('una envolvente tiene los puntos desordenados',
              'envolvente ' + (n + 1) + ': el beat ' + ts[k] + ' viene despues del ' + ts[k - 1]);
          return;
        }
      }
    });

    return problemas;
  }

  // ================================================================ renombrar y reordenar
  //
  // COMO GUARDA LIVE EL ORDEN DE LAS PISTAS. Adentro de <Tracks> hay una lista PLANA: un
  // grupo NO contiene a sus hijos, los precede, y el parentesco lo dice <TrackGroupId>.
  // El orden en que Live las muestra es el orden en que estan escritas.
  //
  // Medido sobre HIBRYD.als, que tiene grupos anidados de verdad (DECK1 > ACIDLEAD > ACID):
  // ningun bloque de pista contiene a otro. Cero pares anidados.
  //
  // Eso tiene dos consecuencias, y las dos importan para mover:
  //   - los hijos de un grupo son el tramo CONTIGUO que viene despues de el
  //   - mover un grupo es mover ese tramo entero, no la linea del grupo
  var TIPOS_PISTA = /<(AudioTrack|MidiTrack|GroupTrack|ReturnTrack)\b([^>]*)>/g;

  // Todas las pistas en el orden en que estan escritas, con donde empieza y donde termina
  // el bloque de cada una. `nivel` es cuantos grupos tiene encima.
  function listaTracks(xml) {
    var out = [], m;
    TIPOS_PISTA.lastIndex = 0;
    while ((m = TIPOS_PISTA.exec(xml))) {
      var cierre = '</' + m[1] + '>';
      var fin = xml.indexOf(cierre, m.index);
      if (fin < 0) continue;
      fin += cierre.length;
      var blk = xml.slice(m.index, fin);
      var id = /\bId="(\d+)"/.exec(m[2]);
      var nm = /<EffectiveName Value="([^"]*)"/.exec(blk);
      var gid = /<TrackGroupId Value="(-?\d+)"/.exec(blk);
      out.push({ tipo: m[1], id: id ? id[1] : null, nombre: nm ? nm[1] : '',
                 grupo: gid ? gid[1] : '-1', ini: m.index, fin: fin });
      TIPOS_PISTA.lastIndex = fin;      // no volver a entrar adentro del bloque que ya lei
    }
    return out;
  }

  // ------------------------------------------------------------------------ renombrar
  //
  // Se escriben EffectiveName Y UserName. EffectiveName es el que Live muestra; UserName es
  // el que vos escribiste. Si se toca solo uno, al abrir el Set Live recalcula y vuelve el
  // viejo.
  //
  // OJO: <EffectiveName> aparece UNA vez por pista, pero <UserName> aparece cuatro o cinco
  // —cada device tiene el suyo—. Por eso no se reemplaza "el primer UserName del bloque"
  // sino el que vive adentro del mismo <Name>...</Name> que el EffectiveName de la pista.
  function renombrarTrack(xml, id, nombre) {
    var t = null, lista = listaTracks(xml);
    for (var i = 0; i < lista.length; i++) if (lista[i].id === String(id)) { t = lista[i]; break; }
    if (!t) return null;

    var blk = xml.slice(t.ini, t.fin);
    var pos = blk.indexOf('<EffectiveName Value="');
    if (pos < 0) return null;
    var abre = blk.lastIndexOf('<Name>', pos);
    var cierra = blk.indexOf('</Name>', pos);
    if (abre < 0 || cierra < 0) return null;

    var val = escXml(String(nombre));
    var dentro = blk.slice(abre, cierra)
      .replace(/<EffectiveName Value="[^"]*"/, '<EffectiveName Value="' + val + '"')
      .replace(/<UserName Value="[^"]*"/, '<UserName Value="' + val + '"');
    var nuevo = blk.slice(0, abre) + dentro + blk.slice(cierra);
    return xml.slice(0, t.ini) + nuevo + xml.slice(t.fin);
  }

  function escXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
  }

  function nombreDeTrackEnBloque(blk) {
    var nm = /<EffectiveName Value="([^"]*)"/.exec(blk);
    return nm ? nm[1] : '';
  }

  function colorDeTrackEnBloque(blk) {
    var m = /<Color Value="(-?\d+)"\s*\/>/.exec(blk);
    return m ? +m[1] : null;
  }

  function setTrackNameEnBloque(blk, nombre) {
    var pos = blk.indexOf('<EffectiveName Value="');
    if (pos < 0) return blk;
    var abre = blk.lastIndexOf('<Name>', pos);
    var cierra = blk.indexOf('</Name>', pos);
    if (abre < 0 || cierra < 0) return blk;

    var val = escXml(String(nombre));
    var dentro = blk.slice(abre, cierra)
      .replace(/<EffectiveName Value="[^"]*"/, '<EffectiveName Value="' + val + '"')
      .replace(/<UserName Value="[^"]*"/, '<UserName Value="' + val + '"')
      .replace(/<MemorizedFirstClipName Value="[^"]*"/, '<MemorizedFirstClipName Value=""');
    return blk.slice(0, abre) + dentro + blk.slice(cierra);
  }

  function vaciarAutomationEnvelopes(blk) {
    return blk.replace(/<AutomationEnvelopes>[\s\S]*?<\/AutomationEnvelopes>/,
                       '<AutomationEnvelopes>\n\t\t\t\t<Envelopes />\n\t\t\t</AutomationEnvelopes>');
  }

  function vaciarTakeLanes(blk) {
    return blk.replace(/<TakeLanes>[\s\S]*?<AreTakeLanesFolded Value="(?:true|false)" \/>[\s\S]*?<\/TakeLanes>/,
      '<TakeLanes>\n\t\t\t\t<TakeLanes />\n\t\t\t\t<AreTakeLanesFolded Value="true" />\n\t\t\t</TakeLanes>');
  }

  function vaciarArrangerAutomation(blk) {
    return blk.replace(/<ArrangerAutomation>[\s\S]*?<\/ArrangerAutomation>/,
      '<ArrangerAutomation>\n\t\t\t\t\t\t\t<Events />\n\t\t\t\t\t\t\t<AutomationTransformViewState>\n\t\t\t\t\t\t\t\t<IsTransformPending Value="false" />\n\t\t\t\t\t\t\t\t<TimeAndValueTransforms />\n\t\t\t\t\t\t\t</AutomationTransformViewState>\n\t\t\t\t\t\t</ArrangerAutomation>');
  }

  function asegurarClipTimeableMidi(blk) {
    if (/<ClipTimeable>[\s\S]*?<ArrangerAutomation>/.test(blk)) return blk;
    var clipTimeable = '<ClipTimeable>\n\t\t\t\t\t\t<ArrangerAutomation>\n\t\t\t\t\t\t\t<Events />\n\t\t\t\t\t\t\t<AutomationTransformViewState>\n\t\t\t\t\t\t\t\t<IsTransformPending Value="false" />\n\t\t\t\t\t\t\t\t<TimeAndValueTransforms />\n\t\t\t\t\t\t\t</AutomationTransformViewState>\n\t\t\t\t\t\t</ArrangerAutomation>\n\t\t\t\t\t</ClipTimeable>';
    if (/<MonitoringEnum\b[^>]*\/>/.test(blk))
      return blk.replace(/(<MonitoringEnum\b[^>]*\/>)/, '$1\n\t\t\t\t\t' + clipTimeable);
    if (/<ClipSlotList>[\s\S]*?<\/ClipSlotList>/.test(blk))
      return blk.replace(/(<\/ClipSlotList>)/, '$1\n\t\t\t\t\t' + clipTimeable);
    return blk;
  }

  function vaciarClipSlots(blk) {
    return blk
      .replace(/<(AudioClip|MidiClip)\b[\s\S]*?<\/\1>/g, '')
      .replace(/<Value>\s*<\/Value>/g, '<Value />');
  }

  function ponerMidiOutputEnNone(blk) {
    return blk.replace(/<MidiOutputRouting>[\s\S]*?<\/MidiOutputRouting>/,
      '<MidiOutputRouting>\n\t\t\t\t\t<Target Value="MidiOut/None" />\n\t\t\t\t\t<UpperDisplayString Value="None" />\n\t\t\t\t\t<LowerDisplayString Value="" />\n\t\t\t\t\t<MpeSettings>\n\t\t\t\t\t\t<ZoneType Value="0" />\n\t\t\t\t\t\t<FirstNoteChannel Value="1" />\n\t\t\t\t\t\t<LastNoteChannel Value="15" />\n\t\t\t\t\t</MpeSettings>\n\t\t\t\t</MidiOutputRouting>');
  }

  function vaciarDevicesTopLevel(blk) {
    var dc0 = blk.indexOf('<DeviceChain>');
    var dc1 = blk.indexOf('</DeviceChain>');
    if (dc0 < 0 || dc1 < 0) return blk;
    var seg = blk.slice(dc0, dc1);
    var d0 = seg.lastIndexOf('<Devices');
    if (d0 < 0) return blk;
    var gt = seg.indexOf('>', d0);
    if (gt < 0) return blk;
    if (seg.charAt(gt - 1) === '/') return blk;
    var d1 = seg.lastIndexOf('</Devices>');
    if (d1 < 0 || d1 < d0) return blk;
    seg = seg.slice(0, d0) + '<Devices />' + seg.slice(d1 + '</Devices>'.length);
    return blk.slice(0, dc0) + seg + blk.slice(dc1);
  }

  function asegurarVelocityDetail(blk) {
    if (/<VelocityDetail\b/.test(blk)) return blk;
    if (/<NeedArrangerRefreeze\b/.test(blk))
      return blk.replace(/<NeedArrangerRefreeze\b/, '<VelocityDetail Value="0" />\n\t\t\t\t<NeedArrangerRefreeze');
    if (/<Freeze\b/.test(blk))
      return blk.replace(/<Freeze\b/, '<VelocityDetail Value="0" />\n\t\t\t\t<Freeze');
    return blk;
  }

  function setTrackUnfolded(blk, abierto) {
    var val = abierto ? 'true' : 'false';
    if (/<TrackUnfolded Value="[^"]*"\s*\/>/.test(blk))
      return blk.replace(/<TrackUnfolded Value="[^"]*"\s*\/>/, '<TrackUnfolded Value="' + val + '" />');
    return blk;
  }

  function setAutomationLaneHeight(blk, alto) {
    var val = String(alto);
    return blk.replace(/<LaneHeight Value="[^"]*"\s*\/>/g, '<LaneHeight Value="' + val + '" />');
  }

  function setSessionTrackWidth(blk, ancho) {
    var val = String(ancho);
    if (/<ViewStateSesstionTrackWidth Value="[^"]*"\s*\/>/.test(blk))
      return blk.replace(/<ViewStateSesstionTrackWidth Value="[^"]*"\s*\/>/g,
        '<ViewStateSesstionTrackWidth Value="' + val + '" />');
    return blk;
  }

  function remapIdsEnBloque(blk, nextId, nextPointeeId) {
    var ids = {}, pids = {};
    blk = blk.replace(/\bId="(\d+)"/g, function (_, n) {
      if (!ids[n]) ids[n] = String(nextId++);
      return 'Id="' + ids[n] + '"';
    });
    blk = blk.replace(/<(\w*PointeeId)\s+Value="(\d+)"/g, function (_, tag, n) {
      if (tag === 'NextPointeeId') return _;
      if (!pids[n]) pids[n] = String(nextPointeeId++);
      return '<' + tag + ' Value="' + pids[n] + '"';
    });
    return { xml: blk, nextId: nextId, nextPointeeId: nextPointeeId };
  }

  function bloqueGuideMidiDesdeAudio(blk, opts) {
    opts = opts || {};
    var color = opts.colorIndice;
    if (color === undefined || color === null) color = colorDeTrackEnBloque(blk);

    var out = blk
      .replace(/^<AudioTrack\b/, '<MidiTrack')
      .replace(/<\/AudioTrack>\s*$/, '</MidiTrack>');
    out = setTrackNameEnBloque(out, opts.nombre || (nombreDeTrackEnBloque(blk) + ' — GUIDE'));
    if (color !== undefined && color !== null)
      out = out.replace(/<Color Value="-?\d+"\s*\/>/, '<Color Value="' + color + '" />');
    out = vaciarAutomationEnvelopes(out);
    out = vaciarTakeLanes(out);
    out = vaciarArrangerAutomation(out);
    out = vaciarClipSlots(out);
    out = ponerMidiOutputEnNone(out);
    out = vaciarDevicesTopLevel(out);
    out = asegurarVelocityDetail(out);
    out = setTrackUnfolded(out, false);
    out = setAutomationLaneHeight(out, 51);
    out = setSessionTrackWidth(out, 17);
    out = asegurarClipTimeableMidi(out);
    return out;
  }

  function insertarTrackDespues(xml, id, bloqueNuevo) {
    var lista = listaTracks(xml), i = -1;
    for (var k = 0; k < lista.length; k++) if (lista[k].id === String(id)) { i = k; break; }
    if (i < 0) return null;
    var pos = lista[i].fin;
    return xml.slice(0, pos) + '\n' + bloqueNuevo + xml.slice(pos);
  }

  function bloqueCompletoTrackById(xml, id) {
    var lista = listaTracks(xml);
    for (var i = 0; i < lista.length; i++)
      if (lista[i].id === String(id)) return xml.slice(lista[i].ini, lista[i].fin);
    return null;
  }

  function reemplazarTrackCompletoById(xml, id, blk2) {
    var lista = listaTracks(xml);
    for (var i = 0; i < lista.length; i++)
      if (lista[i].id === String(id))
        return xml.slice(0, lista[i].ini) + blk2 + xml.slice(lista[i].fin);
    return null;
  }

  function loopsSessionEnBloque(blk) {
    var zona = (/<ClipSlotList>[\s\S]*?<\/ClipSlotList>/.exec(blk) || [''])[0];
    var out = [], re = /<(AudioClip|MidiClip)\b[\s\S]*?<\/\1>/g, m;
    while ((m = re.exec(zona))) {
      var ini = /<CurrentStart Value="([-\d.eE]+)"/.exec(m[0]);
      var fin = /<CurrentEnd Value="([-\d.eE]+)"/.exec(m[0]);
      var largo = ini && fin ? parseFloat(fin[1]) - parseFloat(ini[1]) : 0;
      if (largo > 0) out.push({ beats: largo });
    }
    return out;
  }

  function addGuideMidiTracks(xml, trackIds, opts) {
    opts = opts || {};
    var elegidos = {}, i;
    for (i = 0; i < (trackIds || []).length; i++) elegidos[String(trackIds[i])] = 1;

    var orden = listaTracks(xml).filter(function (t) {
      return t.tipo === 'AudioTrack' && elegidos[String(t.id)];
    });
    var nombresUsados = {};
    listaTracks(xml).forEach(function (t) {
      if (t && t.nombre) nombresUsados[t.nombre] = (nombresUsados[t.nombre] || 0) + 1;
    });
    var logs = [], guias = [];
    var nextId = maxId(xml) + 1;
    var nextP = maxPointeeId(xml) + 1;

    for (i = 0; i < orden.length; i++) {
      var t = orden[i];
      var src = bloqueCompletoTrackById(xml, t.id);
      if (!src) continue;
      var nombreSrc = nombreDeTrackEnBloque(src) || t.nombre || t.id;
      var color = colorDeTrackEnBloque(src);
      var loopsFuente = loopsSessionEnBloque(src);
      if (!loopsFuente.length) loopsFuente = [{ beats: 16 }];
      var nombreGuide = (opts.nameOf ? opts.nameOf(nombreSrc, t) : (nombreSrc + ' — GUIDE'));
      if (!nombreGuide) nombreGuide = nombreSrc + ' — GUIDE';
      var baseGuide = nombreGuide, suf = 2;
      while (nombresUsados[nombreGuide]) nombreGuide = baseGuide + ' ' + (suf++);
      nombresUsados[nombreGuide] = 1;
      var nombreLoop = (opts.loopNameOf ? opts.loopNameOf(nombreSrc, t, nombreGuide) : nombreGuide);
      if (!nombreLoop) nombreLoop = nombreGuide;

      logs.push({ tipo: 'audio-found', trackId: t.id, nombre: nombreSrc });
      var armado = remapIdsEnBloque(
        bloqueGuideMidiDesdeAudio(src, { nombre: nombreGuide, colorIndice: color }),
        nextId, nextP
      );
      nextId = armado.nextId;
      nextP = armado.nextPointeeId;
      xml = insertarTrackDespues(xml, t.id, armado.xml);
      if (!xml) throw new Error('no pude insertar la pista GUIDE después de ' + nombreSrc);

      var listaNueva = listaTracks(xml);
      var idx = -1;
      for (var q = 0; q < listaNueva.length; q++) {
        if (listaNueva[q].nombre === nombreGuide && listaNueva[q].tipo === 'MidiTrack') idx = q;
      }
      if (idx < 0) throw new Error('la pista GUIDE no quedó escrita: ' + nombreGuide);
      var guia = listaNueva[idx];
      var seeded = seedGuideMidiLoops(xml, guia.id, {
        loops: loopsFuente,
        nombre: nombreLoop,
        colorIndice: color
      });
      if (seeded) xml = seeded;
      else throw new Error('no pude sembrar el loop base GUIDE en ' + nombreGuide);
      listaNueva = listaTracks(xml);
      idx = -1;
      for (q = 0; q < listaNueva.length; q++) {
        if (listaNueva[q].nombre === nombreGuide && listaNueva[q].tipo === 'MidiTrack') idx = q;
      }
      guia = listaNueva[idx];
      nextId = maxId(xml) + 1;
      nextP = maxPointeeId(xml) + 1;
      logs.push({ tipo: 'guide-created', trackId: guia.id, nombre: nombreGuide });
      guias.push({
        sourceId: String(t.id),
        sourceName: nombreSrc,
        guideId: String(guia.id),
        guideName: nombreGuide,
        colorIndice: color,
        loopBeats: loopsFuente.map(function (l) { return l.beats; }),
        ordenEsperado: idx
      });
    }

    return { xml: fixNextPointeeId(xml), logs: logs, guides: guias };
  }

  function validateGuideMidiTracks(xml, guides) {
    var problemas = [];
    var lista = listaTracks(xml);
    var porId = {};
    lista.forEach(function (t, i) { porId[String(t.id)] = { meta: t, idx: i }; });

    (guides || []).forEach(function (g) {
      var src = porId[String(g.sourceId)];
      var dst = porId[String(g.guideId)];
      if (!src) { problemas.push('no existe la pista origen ' + g.sourceName); return; }
      if (!dst) { problemas.push('no existe la pista GUIDE ' + g.guideName); return; }
      if (dst.meta.tipo !== 'MidiTrack')
        problemas.push(g.guideName + ': no quedó como MidiTrack');
      if (dst.idx !== src.idx + 1)
        problemas.push(g.guideName + ': no quedó inmediatamente después de ' + g.sourceName);

      var blk = bloqueCompletoTrackById(xml, g.guideId);
      if (!blk) { problemas.push(g.guideName + ': no pude leer el bloque'); return; }
      if (nombreDeTrackEnBloque(blk) !== g.guideName)
        problemas.push(g.guideName + ': el nombre no coincide');
      if (g.colorIndice !== null && g.colorIndice !== undefined && colorDeTrackEnBloque(blk) !== g.colorIndice)
        problemas.push(g.guideName + ': el color no coincide');
      if (!/<MidiOutputRouting>[\s\S]*?<Target Value="MidiOut\/None" \/>/.test(blk))
        problemas.push(g.guideName + ': el MIDI out no quedó en None');
      if (/<AudioClip\b/.test((/<ArrangerAutomation>[\s\S]*?<\/ArrangerAutomation>/.exec(blk) || [''])[0]))
        problemas.push(g.guideName + ': apareció un AudioClip en Arrangement');
      var loopsGuide = loopsSessionEnBloque(blk);
      if (!loopsGuide.length)
        problemas.push(g.guideName + ': no quedó el loop base GUIDE en Session');
      if (g.loopBeats && loopsGuide.length !== g.loopBeats.length)
        problemas.push(g.guideName + ': no quedó un loop GUIDE por cada loop fuente');
      (g.loopBeats || []).forEach(function (largo, i) {
        if (loopsGuide[i] && Math.abs(loopsGuide[i].beats - largo) > 1e-6)
          problemas.push(g.guideName + ': el loop GUIDE ' + (i + 1) + ' dura ' +
            loopsGuide[i].beats + ' beats y el fuente dura ' + largo);
      });
      if (!/<Devices\s*\/>/.test(blk))
        problemas.push(g.guideName + ': la cadena de devices no quedó vacía');
    });

    return problemas;
  }

  function num6(n) {
    return String(Math.round(Number(n || 0) * 1e6) / 1e6);
  }

  function buildGuideMidiClip(beat, largo, id, nombre, colorIndice) {
    var color = (colorIndice === undefined || colorIndice === null) ? 0 : colorIndice;
    var name = escXml(String(nombre || 'GUIDE'));
    var t0 = num6(beat), t1 = num6(beat + largo), len = num6(largo);
    return '<MidiClip Id="' + id + '" Time="' + t0 + '">' +
      '<LomId Value="0" />' +
      '<LomIdView Value="0" />' +
      '<CurrentStart Value="' + t0 + '" />' +
      '<CurrentEnd Value="' + t1 + '" />' +
      '<Loop>' +
        '<LoopStart Value="0" />' +
        '<LoopEnd Value="' + len + '" />' +
        '<StartRelative Value="0" />' +
        '<LoopOn Value="false" />' +
        '<OutMarker Value="' + len + '" />' +
        '<HiddenLoopStart Value="0" />' +
        '<HiddenLoopEnd Value="' + len + '" />' +
      '</Loop>' +
      '<Name Value="' + name + '" />' +
      '<Annotation Value="" />' +
      '<Color Value="' + color + '" />' +
      '<LaunchMode Value="0" />' +
      '<LaunchQuantisation Value="0" />' +
      '<TimeSignature><TimeSignatures><RemoteableTimeSignature Id="0">' +
        '<Numerator Value="4" />' +
        '<Denominator Value="4" />' +
        '<Time Value="0" />' +
      '</RemoteableTimeSignature></TimeSignatures></TimeSignature>' +
      '<Envelopes><Envelopes /></Envelopes>' +
      '<ScrollerTimePreserver><LeftTime Value="0" /><RightTime Value="0" /></ScrollerTimePreserver>' +
      '<TimeSelection><AnchorTime Value="0" /><OtherTime Value="0" /></TimeSelection>' +
      '<Legato Value="false" />' +
      '<Ram Value="false" />' +
      '<GrooveSettings><GrooveId Value="-1" /></GrooveSettings>' +
      '<Disabled Value="true" />' +
      '<VelocityAmount Value="0" />' +
      '<FollowAction>' +
        '<FollowTime Value="4" />' +
        '<IsLinked Value="true" />' +
        '<LoopIterations Value="1" />' +
        '<FollowActionA Value="4" />' +
        '<FollowActionB Value="0" />' +
        '<FollowChanceA Value="100" />' +
        '<FollowChanceB Value="0" />' +
        '<JumpIndexA Value="0" />' +
        '<JumpIndexB Value="0" />' +
        '<FollowActionEnabled Value="false" />' +
      '</FollowAction>' +
      '<Grid>' +
        '<FixedNumerator Value="1" />' +
        '<FixedDenominator Value="16" />' +
        '<GridIntervalPixel Value="20" />' +
        '<Ntoles Value="2" />' +
        '<SnapToGrid Value="true" />' +
        '<Fixed Value="false" />' +
      '</Grid>' +
      '<FreezeStart Value="0" />' +
      '<FreezeEnd Value="0" />' +
      '<IsWarped Value="true" />' +
      '<TakeId Value="1" />' +
      '<Notes>' +
        '<KeyTracks />' +
        '<PerNoteEventStore><EventLists /></PerNoteEventStore>' +
        '<NoteIdGenerator><NextId Value="0" /></NoteIdGenerator>' +
      '</Notes>' +
      '<BankSelectCoarse Value="-1" />' +
      '<BankSelectFine Value="-1" />' +
      '<ProgramChange Value="-1" />' +
      '<NoteEditorFoldInZoom Value="-1" />' +
      '<NoteEditorFoldInScroll Value="-1" />' +
      '<NoteEditorFoldOutZoom Value="176" />' +
      '<NoteEditorFoldOutScroll Value="-11" />' +
      '<NoteEditorFoldScaleZoom Value="-1" />' +
      '<NoteEditorFoldScaleScroll Value="0" />' +
      '<ScaleInformation><RootNote Value="0" /><Name Value="Major" /></ScaleInformation>' +
      '<IsInKey Value="false" />' +
      '<NoteSpellingPreference Value="3" />' +
      '<PreferFlatRootNote Value="false" />' +
      '<ExpressionGrid>' +
        '<FixedNumerator Value="1" />' +
        '<FixedDenominator Value="16" />' +
        '<GridIntervalPixel Value="20" />' +
        '<Ntoles Value="2" />' +
        '<SnapToGrid Value="false" />' +
        '<Fixed Value="false" />' +
      '</ExpressionGrid>' +
    '</MidiClip>';
  }

  function buildGuideSessionMidiClip(largo, id, nombre, colorIndice) {
    var color = (colorIndice === undefined || colorIndice === null) ? 0 : colorIndice;
    var name = escXml(String(nombre || 'GUIDE LOOP'));
    var len = num6(largo);
    return '<MidiClip Id="' + id + '" Time="0">' +
      '<LomId Value="0" />' +
      '<LomIdView Value="0" />' +
      '<CurrentStart Value="0" />' +
      '<CurrentEnd Value="' + len + '" />' +
      '<Loop>' +
        '<LoopStart Value="0" />' +
        '<LoopEnd Value="' + len + '" />' +
        '<StartRelative Value="0" />' +
        '<LoopOn Value="true" />' +
        '<OutMarker Value="' + len + '" />' +
        '<HiddenLoopStart Value="0" />' +
        '<HiddenLoopEnd Value="' + len + '" />' +
      '</Loop>' +
      '<Name Value="' + name + '" />' +
      '<Annotation Value="" />' +
      '<Color Value="' + color + '" />' +
      '<LaunchMode Value="0" />' +
      '<LaunchQuantisation Value="0" />' +
      '<TimeSignature><TimeSignatures><RemoteableTimeSignature Id="0">' +
        '<Numerator Value="4" />' +
        '<Denominator Value="4" />' +
        '<Time Value="0" />' +
      '</RemoteableTimeSignature></TimeSignatures></TimeSignature>' +
      '<Envelopes><Envelopes /></Envelopes>' +
      '<ScrollerTimePreserver><LeftTime Value="0" /><RightTime Value="0" /></ScrollerTimePreserver>' +
      '<TimeSelection><AnchorTime Value="0" /><OtherTime Value="0" /></TimeSelection>' +
      '<Legato Value="false" />' +
      '<Ram Value="false" />' +
      '<GrooveSettings><GrooveId Value="-1" /></GrooveSettings>' +
      '<Disabled Value="false" />' +
      '<VelocityAmount Value="0" />' +
      '<FollowAction>' +
        '<FollowTime Value="4" />' +
        '<IsLinked Value="true" />' +
        '<LoopIterations Value="1" />' +
        '<FollowActionA Value="4" />' +
        '<FollowActionB Value="0" />' +
        '<FollowChanceA Value="100" />' +
        '<FollowChanceB Value="0" />' +
        '<JumpIndexA Value="1" />' +
        '<JumpIndexB Value="1" />' +
        '<FollowActionEnabled Value="false" />' +
      '</FollowAction>' +
      '<Grid>' +
        '<FixedNumerator Value="1" />' +
        '<FixedDenominator Value="16" />' +
        '<GridIntervalPixel Value="20" />' +
        '<Ntoles Value="2" />' +
        '<SnapToGrid Value="true" />' +
        '<Fixed Value="true" />' +
      '</Grid>' +
      '<FreezeStart Value="0" />' +
      '<FreezeEnd Value="0" />' +
      '<IsWarped Value="true" />' +
      '<TakeId Value="-1" />' +
      '<Notes>' +
        '<KeyTracks />' +
        '<PerNoteEventStore><EventLists /></PerNoteEventStore>' +
        '<NoteIdGenerator><NextId Value="1" /></NoteIdGenerator>' +
      '</Notes>' +
      '<BankSelectCoarse Value="-1" />' +
      '<BankSelectFine Value="-1" />' +
      '<ProgramChange Value="-1" />' +
      '<NoteEditorFoldInZoom Value="1408" />' +
      '<NoteEditorFoldInScroll Value="-385" />' +
      '<NoteEditorFoldOutZoom Value="-1" />' +
      '<NoteEditorFoldOutScroll Value="0" />' +
      '<NoteEditorFoldScaleZoom Value="-1" />' +
      '<NoteEditorFoldScaleScroll Value="0" />' +
      '<ScaleInformation><RootNote Value="0" /><Name Value="Major" /></ScaleInformation>' +
      '<IsInKey Value="false" />' +
      '<NoteSpellingPreference Value="3" />' +
      '<PreferFlatRootNote Value="false" />' +
      '<ExpressionGrid>' +
        '<FixedNumerator Value="1" />' +
        '<FixedDenominator Value="16" />' +
        '<GridIntervalPixel Value="20" />' +
        '<Ntoles Value="2" />' +
        '<SnapToGrid Value="false" />' +
        '<Fixed Value="false" />' +
      '</ExpressionGrid>' +
    '</MidiClip>';
  }

  function seedGuideMidiLoops(xml, trackId, opts) {
    opts = opts || {};
    var blk = bloqueCompletoTrackById(xml, trackId);
    if (!blk) return null;
    var largos = (opts.loops || []).map(function (l) {
      return Number(typeof l === 'number' ? l : (l && (l.beats || l.largo)));
    }).filter(function (l) { return l > 0; });
    if (!largos.length) largos = [16];

    var clipId = maxId(xml) + 1, indice = 0;
    var re = /(<ClipSlot\b[\s\S]*?<ClipSlot>\s*)(<Value\s*\/>)(\s*<\/ClipSlot>[\s\S]*?<\/ClipSlot>)/g;
    var blk2 = blk.replace(re, function (todo, a, _empty, c) {
      if (indice >= largos.length) return todo;
      var nombre = opts.nombre || 'GUIDE LOOP';
      if (indice > 0) nombre += ' ' + (indice + 1);
      var clipXml = buildGuideSessionMidiClip(largos[indice], clipId++, nombre, opts.colorIndice);
      indice++;
      return a + '<Value>' + clipXml + '</Value>' + c;
    });
    if (indice !== largos.length) return null;
    return reemplazarTrackCompletoById(xml, trackId, blk2);
  }

  function armarTakeLaneMidi(clipsXml, laneId) {
    laneId = (laneId === undefined || laneId === null) ? 0 : laneId;
    return '<TakeLanes>' +
        '<TakeLanes>' +
          '<TakeLane Id="' + laneId + '">' +
            '<Height Value="51" />' +
            '<IsContentSelectedInDocument Value="false" />' +
            '<ClipAutomation>' +
              '<Events>' + clipsXml + '</Events>' +
              '<AutomationTransformViewState>' +
                '<IsTransformPending Value="false" />' +
                '<TimeAndValueTransforms />' +
              '</AutomationTransformViewState>' +
            '</ClipAutomation>' +
            '<Name Value="Lane" />' +
            '<Annotation Value="" />' +
            '<Audition Value="false" />' +
          '</TakeLane>' +
        '</TakeLanes>' +
        '<AreTakeLanesFolded Value="true" />' +
      '</TakeLanes>';
  }

  function setTrackArrangementClips(xml, trackId, clipsXml, reemplazar) {
    var blk = bloqueCompletoTrackById(xml, trackId);
    if (!blk) return null;
    if (/^<MidiTrack\b/.test(blk)) {
      var laneBase = maxId(blk) + 1;
      var takeXml = armarTakeLaneMidi(clipsXml, laneBase);
      var blkMidi = null;
      if (/<TakeLanes>[\s\S]*?<AreTakeLanesFolded Value="(?:true|false)" \/>[\s\S]*?<\/TakeLanes>/.test(blk)) {
        blkMidi = blk.replace(
          /<TakeLanes>[\s\S]*?<AreTakeLanesFolded Value="(?:true|false)" \/>[\s\S]*?<\/TakeLanes>/,
          takeXml
        );
      } else return null;
      return reemplazarTrackCompletoById(xml, trackId, blkMidi);
    }
    var zona = /<ArrangerAutomation>([\s\S]*?)<\/ArrangerAutomation>/.exec(blk);
    if (!zona) return null;
    var cuerpo = zona[1], nuevo = null;
    if (/<Events\s*\/>/.test(cuerpo)) {
      nuevo = cuerpo.replace(/<Events\s*\/>/, '<Events>' + clipsXml + '</Events>');
    } else if (/(<Events>)([\s\S]*?)(<\/Events>)/.test(cuerpo)) {
      nuevo = cuerpo.replace(/(<Events>)([\s\S]*?)(<\/Events>)/, function (_, a, b, c) {
        return a + (reemplazar ? '' : b) + clipsXml + c;
      });
    } else return null;
    var blk2 = blk.replace(zona[0], '<ArrangerAutomation>' + nuevo + '</ArrangerAutomation>');
    return reemplazarTrackCompletoById(xml, trackId, blk2);
  }

  // ------------------------------------------------------------------------ reordenar
  //
  // Se mueve entre HERMANAS: pistas con el mismo TrackGroupId. Sacar una pista de su grupo,
  // o meterla en otro, es otra operacion —cambia el ruteo, no el orden— y no se hace aca.
  //
  // Las ReturnTrack quedan afuera: van despues de todas las pistas y moverlas ahi rompe el
  // Set. Tampoco se tocan Master ni PreHear, que ni siquiera se listan como hermanas.

  // El tramo que ocupa una pista: ella sola, o ella MAS todos sus descendientes si es un
  // grupo. Como la lista es plana y los hijos vienen pegados atras, el tramo es contiguo.
  function tramoDe(lista, i) {
    var n = 1;
    if (lista[i].tipo !== 'GroupTrack') return n;
    var dentro = {};
    dentro[lista[i].id] = 1;
    for (var j = i + 1; j < lista.length; j++) {
      if (!dentro[lista[j].grupo]) break;          // se corto la cadena: termino el grupo
      if (lista[j].tipo === 'GroupTrack') dentro[lista[j].id] = 1;
      n++;
    }
    return n;
  }

  // Mueve la pista `id` un lugar arriba (delta -1) o abajo (delta +1) entre sus hermanas.
  // Devuelve el XML nuevo, o null si no se puede: no existe, es un return, o ya esta en la
  // punta. Null es "no pasa nada", no un error.
  function moverTrack(xml, id, delta) {
    var lista = listaTracks(xml);
    var i = -1;
    for (var k = 0; k < lista.length; k++) if (lista[k].id === String(id)) { i = k; break; }
    if (i < 0 || lista[i].tipo === 'ReturnTrack') return null;

    // Las hermanas se buscan ADENTRO DEL TRAMO DEL PADRE, no en toda la lista. Barriendo
    // desde cero, el primer paso se saltea el grupo entero —sus hijos son parte de su
    // tramo— y las hermanas de adentro no aparecian nunca.
    var desde = 0, hasta = lista.length;
    if (lista[i].grupo !== '-1') {
      var g = -1;
      for (var q = 0; q < lista.length; q++)
        if (lista[q].id === lista[i].grupo && lista[q].tipo === 'GroupTrack') { g = q; break; }
      if (g < 0) return null;
      desde = g + 1;
      hasta = g + tramoDe(lista, g);
    }

    var hermanas = [], p = desde;
    while (p < hasta) {
      var largo = tramoDe(lista, p);
      if (lista[p].grupo === lista[i].grupo && lista[p].tipo !== 'ReturnTrack')
        hermanas.push({ desde: p, largo: largo });
      p += largo;
    }
    var pos = -1;
    for (var h = 0; h < hermanas.length; h++) if (hermanas[h].desde === i) { pos = h; break; }
    if (pos < 0) return null;
    var destino = pos + (delta < 0 ? -1 : 1);
    if (destino < 0 || destino >= hermanas.length) return null;   // ya estaba en la punta

    var yo = hermanas[pos], otra = hermanas[destino];
    var miIni = lista[yo.desde].ini, miFin = lista[yo.desde + yo.largo - 1].fin;
    var suIni = lista[otra.desde].ini, suFin = lista[otra.desde + otra.largo - 1].fin;
    var mio = xml.slice(miIni, miFin), suyo = xml.slice(suIni, suFin);

    // Se intercambian los dos tramos enteros. Va del final hacia el principio para que el
    // primer corte no corra los indices del segundo.
    if (delta < 0) {
      return xml.slice(0, suIni) + mio + xml.slice(suFin, miIni) + suyo + xml.slice(miFin);
    }
    return xml.slice(0, miIni) + suyo + xml.slice(miFin, suIni) + mio + xml.slice(suFin);
  }

  var api = {
    listaTracks: listaTracks, renombrarTrack: renombrarTrack, moverTrack: moverTrack,
    addGuideMidiTracks: addGuideMidiTracks, validateGuideMidiTracks: validateGuideMidiTracks,
    buildGuideMidiClip: buildGuideMidiClip, setTrackArrangementClips: setTrackArrangementClips,
    revisar: revisar, maxPointeeId: maxPointeeId,
    setLocators: setLocators, fixNextPointeeId: fixNextPointeeId, maxId: maxId,
    readTempo: readTempo, setTempo: setTempo, tempoAutomatizado: tempoAutomatizado, readTrackNames: readTrackNames, readVersion: readVersion,
    readLocators: readLocators, buildLocators: buildLocators, mmss: mmss,
    volumenDelTrack: volumenDelTrack,
    setEnvelope: setEnvelope, shapePoints: shapePoints, trackNames: trackNames, gruposDe: gruposDe, rutaDeGrupo: rutaDeGrupo,
    trackBlockById: trackBlockById,
    trackBlock: trackBlock, automationTargetId: automationTargetId, readEnvelopes: readEnvelopes, readAllEnvelopes: readAllEnvelopes,
    puntosDeEnvolvente: puntosDeEnvolvente, boolsDeEnvolvente: boolsDeEnvolvente, envolventeComoFormas: envolventeComoFormas,
    formaDeSeccion: formaDeSeccion,
    sendCount: sendCount,
    paramInfo: paramInfo, nodoDeParam: nodoDeParam,
    devicesDeTrack: devicesDeTrack, paramsDeDevice: paramsDeDevice, paramsDeCanal: paramsDeCanal,
    nombreDeDevice: nombreDeDevice, nombreDeParam: nombreDeParam,
    aUnidades: aUnidades, deUnidades: deUnidades, baseEnFormas: baseEnFormas
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ALS = api;
})(typeof window !== 'undefined' ? window : this);
