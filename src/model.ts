import { z } from "zod";

export const CommitRef = z.string().brand("CommitRef");

export type CommitRef = z.infer<typeof CommitRef>;

export const BranchName = z.string().brand("BranchName");

export type BranchName = z.infer<typeof BranchName>;

export const StageName = z.string().brand("StageName");

export type StageName = z.infer<typeof StageName>;
