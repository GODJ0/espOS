import { useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import type { BoardId } from "../../shared/boards";

export function useFirmwareBuilds(board: BoardId) {
  return useQuery({ ...orpc.firmware.list.queryOptions({ input: { board } }), staleTime: 1000 * 60 * 30 });
}
