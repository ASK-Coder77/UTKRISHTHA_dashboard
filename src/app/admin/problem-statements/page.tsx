import { AdminWorkspace } from "@/app/admin/admin-workspace";
import { PostAuctionProblemStatementControls } from "@/app/admin/problem-statements/post-auction-controls";

export default function AdminProblemStatementsPage() {
  return <><AdminWorkspace section="problem-statements" /><PostAuctionProblemStatementControls /></>;
}
