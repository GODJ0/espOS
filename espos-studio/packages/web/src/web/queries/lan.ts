import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useLanConfig() { return useQuery(orpc.lan.config.queryOptions()); }
export function useLanCommand() { return useMutation(orpc.lan.command.mutationOptions()); }