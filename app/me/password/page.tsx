import { requireMember } from "@/lib/auth";
import { load } from "@/lib/store";
import { today } from "@/lib/today";
import { TopBar } from "../../ui";
import PasswordForm from "./PasswordForm";

export default async function Password() {
  const me = await requireMember(await load(today()), { allowPasswordChange: true });
  return (
    <>
      {!me.mustChange && <TopBar current="password" member={me.username} />}
      <main className={me.mustChange ? "login" : "page me"}>
        <PasswordForm first={!!me.mustChange} username={me.username ?? ""} />
      </main>
    </>
  );
}
