import { redirect } from "next/navigation";

export default function LegacyAdminResetPasswordPage() {
  redirect("/forgot-password");
}
