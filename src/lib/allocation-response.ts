import { NextResponse } from "next/server";
import { AllocationError } from "@/lib/allocation";

/** Converts expected allocation-domain failures into safe API responses. */
export function allocationErrorResponse(error: unknown) {
  if (!(error instanceof AllocationError)) return null;

  const responses = {
    invalid_input: ["Invalid allocation request.", 400],
    not_admin: ["You do not have permission to perform this action.", 403],
    not_super_admin: ["Only a super admin can change an auction-won assignment.", 403],
    team_not_found: ["Team not found.", 404],
    team_not_participating: ["Only participating teams can be allocated.", 409],
    team_already_assigned: ["This team already has a problem statement.", 409],
    team_holding_spot: ["This team currently holds a live auction spot.", 409],
    problem_statement_not_found: ["Problem statement not found.", 404],
    auction_still_live: ["Allocation is unavailable while an auction is live.", 409],
    missing_capacity: ["The selected problem statement has no effective capacity.", 409],
    capacity_reached: ["The selected problem statement is at capacity.", 409],
    capacity_confirmation_required: ["Confirm that this allocation may exceed capacity.", 409],
    track_mismatch: ["Teams can be assigned only to problem statements in their own track.", 403],
    round_already_open: ["This assignment can no longer be changed after the round opens.", 409],
    super_admin_confirmation_required: ["A super-admin confirmation is required to change an auction-won assignment.", 403],
    allocation_integrity_error: ["Allocation changed concurrently. Please try again.", 409],
  } as const;
  const [message, status] = responses[error.code];
  return NextResponse.json({ error: message }, { status });
}
