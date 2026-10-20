import { AdminWorkspace } from "@/app/admin/admin-workspace";
import { PostAuctionTeamControls } from "@/app/admin/teams/post-auction-controls";

export default function AdminTeamsPage() {
  return <><AdminWorkspace section="teams" /><PostAuctionTeamControls /></>;
}
