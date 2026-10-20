"use client";

import { useEffect, useState, type FormEvent } from "react";

type Settings = {
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

const labels: Record<keyof Settings, string> = {
  startingPoints: "Starting points",
  eventYear: "Event year",
  defaultTeamsPerPs: "Default teams per problem statement",
  minIncrement: "Minimum bid increment",
  minTeamSize: "Minimum team size",
  maxTeamSize: "Maximum team size",
  registrationOpen: "Team registration is open",
  powerupMultiplier: "Powerup multiplier",
  powerupForAllocatedTeams: "Give allocated teams a powerup",
  allowNonCollegeJudges: "Allow non-college judges",
  allowSameJudgeAcrossRounds: "Allow the same judge across rounds",
  resultsPublished: "Publish results",
  submissionsOpen: "Accept final submissions",
  redemptionOpen: "Allow credit redemption",
};

const numericFields: Array<keyof Settings> = [
  "startingPoints",
  "eventYear",
  "defaultTeamsPerPs",
  "minIncrement",
  "minTeamSize",
  "maxTeamSize",
  "powerupMultiplier",
];

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/settings", { cache: "no-store" });
        const data = (await response.json()) as { settings?: Settings; error?: string };
        if (!response.ok || !data.settings) throw new Error(data.error ?? "Unable to load settings.");
        setSettings(data.settings);
        setDraft(data.settings);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load settings.");
      }
    })();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !settings) return;
    setError(null);
    setMessage(null);
    setIsSaving(true);
    try {
      const changed = Object.fromEntries(
        (Object.keys(draft) as Array<keyof Settings>)
          .filter((key) => draft[key] !== settings[key])
          .map((key) => [key, draft[key]]),
      );
      if (Object.keys(changed).length === 0) {
        setMessage("No changes to save.");
        return;
      }
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      const data = (await response.json()) as { settings?: Settings; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error ?? "Unable to save settings.");
      setSettings(data.settings);
      setDraft(data.settings);
      setMessage("Settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !draft) return <p className="mt-8 rounded-md bg-red-50 p-4 text-red-800">{error}</p>;
  if (!draft) return <p className="mt-8 text-slate-600">Loading settings…</p>;

  return (
    <form className="mt-8 space-y-8" onSubmit={save}>
      <fieldset className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <legend className="px-2 text-lg font-semibold text-slate-950">Points and teams</legend>
        {numericFields.map((field) => (
          <label className="grid gap-2 text-sm font-medium text-slate-800" key={field}>
            {labels[field]}
            <input
              className="rounded-md border border-slate-300 px-3 py-2 text-base text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-border"
              min={field === "defaultTeamsPerPs" ? 1 : 0}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => current && { ...current, [field]: value === "" ? null : Number(value) });
              }}
              step={field === "powerupMultiplier" ? "any" : 1}
              type="number"
              value={typeof draft[field] === "number" ? draft[field] : ""}
            />
            {field === "defaultTeamsPerPs" && <span className="font-normal text-slate-500">Leave blank when each PS must set its own capacity.</span>}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <legend className="px-2 text-lg font-semibold text-slate-950">Event controls</legend>
        {(Object.keys(labels) as Array<keyof Settings>)
          .filter((field) => !numericFields.includes(field))
          .map((field) => (
            <label className="flex items-center justify-between gap-4 rounded-md border border-slate-200 p-4 text-sm font-medium text-slate-800" key={field}>
              {labels[field]}
              <input
                checked={Boolean(draft[field])}
                className="size-5 accent-primary"
                onChange={(event) => setDraft((current) => current && { ...current, [field]: event.target.checked })}
                type="checkbox"
              />
            </label>
          ))}
      </fieldset>

      {error && <p className="rounded-md bg-red-50 p-4 text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded-md bg-emerald-50 p-4 text-emerald-800" role="status">{message}</p>}
      <button
        className="rounded-md bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-slate-400"
        disabled={isSaving}
        type="submit"
      >
        {isSaving ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
