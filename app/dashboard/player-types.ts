export type DashboardPlayer = {
  id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  price: number | string;
  clubs: { id: string; name: string } | { id: string; name: string }[] | null;
};

export type SquadPosition = "starter" | "bench";

export type SquadPlayerOption = DashboardPlayer & {
  position: SquadPosition;
};
