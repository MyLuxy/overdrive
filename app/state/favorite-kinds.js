export const FAVORITE_KINDS = [
    { id: "all", label: "homebrew.kind.all" },
    { id: "app", label: "homebrew.kind.app" },
    { id: "game", label: "homebrew.kind.game" },
    { id: "emulators", label: "genre.emulators" },
    { id: "tool", label: "homebrew.kind.tool" }
  ];
export function matchesFavoriteKind(game, kind = "all") {
    if (kind === "all") return true;
    if (kind === "game") return !game.homebrew || game.homebrew.kind === "game";
    if (!game.homebrew) return false;
    if (kind === "emulators") return game.homebrew.category === "emulators";
    return game.homebrew.kind === kind;
  }
