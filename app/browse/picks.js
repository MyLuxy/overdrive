// The games the store front leads with, chosen by hand (2026-10-17): the spotlight draws from the
// famous ones, "You might like" mixes them with the indie ones and the rest of the catalog. Edit
// freely: an id that is not in the catalog, or whose host is paused, is passed over.

  var FAMOUS = [
    "PPSA31246", "PPSA01500", "PPSA23226", "PPSA04609", "PPSA22327", "PPSA01474", "PPSA08330", "PPSA34015",
    "PPSA17221", "PPSA04029", "PPSA36458", "PPSA02530", "PPSA01467", "PPSA03016", "PPSA01417", "PPSA28180",
    "PPSA03396", "PPSA15508", "PPSA11386", "PPSA17168", "PPSA01903", "PPSA17597", "PPSA13427", "PPSA17905",
    "PPSA03671", "PPSA02225", "PPSA26344", "PPSA21567", "PPSA01285", "PPSA01342", "PPSA01968", "PPSA02015",
    "PPSA01317", "PPSA05389", "PPSA13197", "PPSA30528", "PPSA04264", "PPSA01593", "PPSA14002", "PPSA07411",
    "PPSA01556", "PPSA24191", "PPSA02632", "PPSA10595", "PPSA07570", "PPSA02343", "PPSA08560", "PPSA10621",
    "PPSA02572", "PPSA03845", "PPSA08709", "PPSA15304", "PPSA07783", "PPSA07230", "PPSA20560", "PPSA26786",
    "PPSA21704", "PPSA17599", "PPSA02433", "PPSA01289", "PPSA19534", "PPSA20397"
  ];
  var INDIE = [
    "PPSA12544", "PPSA06465", "PPSA03355", "PPSA36082", "PPSA15552", "CUSA11302", "CUSA20499", "PPSA02154",
    "PPSA13579", "PPSA22520", "PPSA07587", "PPSA09804", "PPSA08102", "PPSA07117", "PPSA09076", "PPSA21402",
    "PPSA16786", "PPSA08766"
  ];
  var shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  // The listed games among `ids`, the catalog's own objects, in a new random order on every launch.
  function picked(games, ids) {
    const byId = new Map(games.map((game) => [game.id, game]));
    return shuffle(ids.map((id) => byId.get(id)).filter(Boolean));
  }

export { FAMOUS, INDIE, picked, shuffle };
