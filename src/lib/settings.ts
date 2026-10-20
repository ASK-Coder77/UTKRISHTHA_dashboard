import { Setting } from "@/models/Setting";
import { connectToDatabase } from "@/lib/db";

export const SETTINGS_SINGLETON_KEY = "global";

export type SettingsRecord = {
  _id: unknown;
  singletonKey: string;
  startingPoints: number;
  eventYear: number;
  defaultTeamsPerPs: number | null;
  minIncrement: number;
  minTeamSize: number;
  maxTeamSize: number;
  registrationOpen: boolean;
  powerupMultiplier: number;
  powerupForAllocatedTeams: boolean;
  allowNonCollegeJudges: boolean;
  allowSameJudgeAcrossRounds: boolean;
  resultsPublished: boolean;
  submissionsOpen: boolean;
  redemptionOpen: boolean;
};

export async function getSettings() {
  await connectToDatabase();
  const settings = await Setting.findOneAndUpdate(
    { singletonKey: SETTINGS_SINGLETON_KEY },
    { $setOnInsert: { singletonKey: SETTINGS_SINGLETON_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return settings as unknown as SettingsRecord;
}
