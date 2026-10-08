// Names: settlements, neighbouring towns, families, inns, shrines, streets.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});

  var PRE = ['Ash', 'Oak', 'Elm', 'Bram', 'Thorn', 'Wil', 'Hart', 'Bex', 'Cold', 'Brack', 'Fen', 'Mar', 'Stan',
    'Wen', 'Hal', 'Lang', 'Rad', 'Sel', 'Kel', 'Hol', 'Bur', 'Ald', 'Ever', 'Fox', 'Hare', 'Crow', 'Rook', 'Swan',
    'Black', 'Grey', 'Red', 'White', 'Stone', 'Mill', 'Brook', 'Lyn', 'Pen', 'Tre', 'Dun', 'Cal', 'Ros', 'Kil',
    'Wych', 'Ather', 'Bel', 'Cor', 'Sto', 'Lox', 'Wither', 'Hazel', 'Rush', 'Sedge', 'Otter', 'Heron', 'Gos', 'Ick'];
  var SUF = {
    valley: ['ford', 'bridge', 'wick', 'ham', 'bourne', 'ley', 'well', 'ton'],
    plains: ['ton', 'by', 'thorpe', 'field', 'ham', 'stead', 'worth', 'ley'],
    coast: ['mouth', 'haven', 'wick', 'port', 'cliff', 'strand', 'sea', 'ness'],
    highlands: ['dale', 'fell', 'crag', 'shaw', 'hope', 'combe', 'tor', 'side'],
    forest: ['holt', 'wood', 'hurst', 'den', 'ley', 'field', 'grove', 'shaw'],
    lakeside: ['mere', 'water', 'pool', 'ey', 'wick', 'ford', 'ton'],
    island: ['holm', 'ey', 'ness', 'wick', 'haven', 'sey'],
    arid: []
  };
  var ARID_A = ['Zar', 'Qas', 'Tel', 'Bir', 'Ain', 'Sur', 'Kha', 'Mar', 'Dur', 'Sab', 'Has', 'Nim', 'Ras', 'Wad'];
  var ARID_B = ['ah', 'im', 'un', 'eth', 'ara', 'ib', 'az', 'oum', 'esh', 'iya', 'an'];

  var SURNAMES = ['Miller', 'Smith', 'Thatcher', 'Cooper', 'Fletcher', 'Baker', 'Brewer', 'Carter', 'Mason',
    'Tanner', 'Weaver', 'Fisher', 'Shepherd', 'Ward', 'Hayward', 'Reeve', 'Wright', 'Turner', 'Dyer', 'Brook',
    'Hill', 'Wood', 'Field', 'Marsh', 'Ford', 'Green', 'Moor', 'Lane', 'Ashby', 'Croft', 'Hale', 'Penn', 'Rowe',
    'Dale', 'Holt', 'Wells', 'Stone', 'Burrow', 'Fenn', 'Hart', 'Crane', 'Finch', 'Wren', 'Lark', 'Rook',
    'Swift', 'Teal', 'Pike', 'Tarrant', 'Oakley', 'Hawes', 'Vane', 'Pell', 'Cobb', 'Mercer', 'Pryor', 'Abbot',
    'Page', 'Ross', 'Quill', 'Tallow', 'Bramble', 'Thorne', 'Sallow', 'Merrow', 'Gage', 'Lowe', 'Ewart'];
  var ARID_SURNAMES = ['al-Hadid', 'Bayt Sur', 'al-Ma\'in', 'Qasimi', 'Tellan', 'Zarif', 'Nimr', 'Rasul', 'Haddad',
    'Sabbagh', 'Najjar', 'Khatib', 'Darwish', 'Bannai', 'Fakhri', 'Wadi'];
  var INN_ADJ = ['Crooked', 'Golden', 'Drowsy', 'Red', 'Laughing', 'Wandering', 'Silver', 'Old', 'Merry',
    'Hollow', 'Painted', 'Black', 'Lucky', 'Weary', 'Green', 'Blind', 'Patient', 'Salt', 'Brass', 'Sleeping'];
  var INN_NOUN = ['Ewe', 'Hart', 'Lantern', 'Plough', 'Barrel', 'Fox', 'Kettle', 'Anchor', 'Wheatsheaf',
    'Goose', 'Pike', 'Crown', 'Boar', 'Heron', 'Cartwheel', 'Bell', 'Moon', 'Otter', 'Hound', 'Pilgrim', 'Mare'];
  var SAINTS = ['Aldric', 'Edwin', 'Brigid', 'Oswin', 'Hild', 'Cuthbert', 'Agnes', 'Wynn', 'Elowen', 'Bede',
    'Morwen', 'Ansel', 'Petroc', 'Ivo', 'Sidonie'];
  var SHRINE = ['the Lantern', 'the Well', 'the Green Hill', 'Seven Stars', 'the Morning', 'the Quiet Hour',
    'the Two Rivers', 'the Hearth', 'Small Mercies', 'the Long Road'];
  var TREES = ['Elder', 'Willow', 'Hawthorn', 'Rowan', 'Birch', 'Alder', 'Yew', 'Linden', 'Chestnut', 'Hazel'];

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function settlement(rand, env, size) {
    if (env === 'arid') return rand.pick(ARID_A) + rand.pick(ARID_B);
    var name = rand.pick(PRE) + rand.pick(SUF[env] || SUF.plains);
    name = name.replace(/([a-z])\1\1/, '$1$1');
    if (size === 'hamlet' && rand() < 0.3) name = 'Little ' + name;
    else if (size === 'city' && rand() < 0.15) name = 'Great ' + name;
    else if (rand() < 0.07) name += rand.pick([' Cross', ' St. ' + rand.pick(SAINTS), ' Magna', ' on the Hill']);
    return name;
  }

  VG.names = {
    settlement: settlement,
    neighbour: function (rand, env) {
      var keys = Object.keys(SUF).filter(function (k) { return SUF[k].length; });
      return settlement(rand, env === 'arid' ? 'arid' : rand.pick(keys), 'village');
    },
    surname: function (rand, env) { return rand.pick(env === 'arid' ? ARID_SURNAMES : SURNAMES); },
    inn: function (rand) { return 'The ' + rand.pick(INN_ADJ) + ' ' + rand.pick(INN_NOUN); },
    church: function (rand) { return 'St. ' + rand.pick(SAINTS) + '’s'; },
    shrine: function (rand) { return 'Chapel of ' + rand.pick(SHRINE); },
    tree: function (rand) { return rand.pick(TREES); },
    cap: cap
  };
})(typeof window !== 'undefined' ? window : globalThis);
