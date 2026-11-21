// The genre cards' pixel art (tools/genre-sprites.py), baked into the app: a card that has one shows
// it instead of three covers, so the rail loads no images. A genre without one keeps its covers.

import action from '../assets/genres/genre-action.png';
import adventure from '../assets/genres/genre-adventure.png';
import arcade from '../assets/genres/genre-arcade.png';
import brain from '../assets/genres/genre-brain.png';
import casual from '../assets/genres/genre-casual.png';
import family from '../assets/genres/genre-family.png';
import fighting from '../assets/genres/genre-fighting.png';
import horror from '../assets/genres/genre-horror.png';
import indie from '../assets/genres/genre-indie.png';
import music from '../assets/genres/genre-music.png';
import party from '../assets/genres/genre-party.png';
import puzzle from '../assets/genres/genre-puzzle.png';
import racing from '../assets/genres/genre-racing.png';
import rpg from '../assets/genres/genre-rpg.png';
import shooter from '../assets/genres/genre-shooter.png';
import simulation from '../assets/genres/genre-simulation.png';
import sport from '../assets/genres/genre-sport.png';
import strategy from '../assets/genres/genre-strategy.png';

  // By the catalog's genre names.
  var GENRE_ART = {
    Action: action,
    Adventure: adventure,
    Arcade: arcade,
    Casual: casual,
    Educational: brain,
    Family: family,
    Fighting: fighting,
    Horror: horror,
    Indie: indie,
    "Music/Rhythm": music,
    Party: party,
    Puzzle: puzzle,
    Racing: racing,
    RPG: rpg,
    Shooter: shooter,
    Simulation: simulation,
    Sport: sport,
    Strategy: strategy
  };

export { GENRE_ART };
