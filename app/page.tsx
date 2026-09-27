import { requireOwner } from "@/lib/auth";
import { load } from "@/lib/store";
import { today } from "@/lib/today";
import { TopBar } from "./ui";
import Dashboard from "./Dashboard";

export default async function Page() {
  await requireOwner();
  const t = today();
  const db = await load(t);
  // Only what the dashboard needs reaches the browser: never password hashes.
  const members = db.members.map(({ id, name }) => ({ id, name }));
  return (
    <>
      <TopBar current="timeline" />
      <Dashboard db={{ ...db, members }} today={t} />
    </>
  );
}
