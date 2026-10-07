"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function BusinessPage() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingUser, setCheckingUser] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function checkUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      // که مخکې معلومات موجود وي، فورم ته یې راوړه
      const { data } = await supabase
        .from("business_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        setBusinessName(data.business_name ?? "");
        setDescription(data.description ?? "");
        setEmail(data.email ?? "");
        setPhone(data.phone ?? "");
        setWebsite(data.website ?? "");
        setAddress(data.address ?? "");
      }

      setCheckingUser(false);
    }

    checkUser();
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage("Please sign in again.");
      setLoading(false);
      router.push("/login");
      return;
    }

    const profile = {
      user_id: user.id,
      business_name: businessName.trim(),
      description: description.trim(),
      email: email.trim(),
      phone: phone.trim(),
      website: website.trim(),
      address: address.trim(),
    };

    // وګوره چې د همدې user معلومات مخکې شته که نه
    const { data: existing, error: checkError } = await supabase
      .from("business_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (checkError) {
      setMessage(checkError.message);
      setLoading(false);
      return;
    }

    let error;

    if (existing) {
      const result = await supabase
        .from("business_profiles")
        .update(profile)
        .eq("user_id", user.id);

      error = result.error;
    } else {
      const result = await supabase
        .from("business_profiles")
        .insert(profile);

      error = result.error;
    }

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setMessage("Business information saved successfully.");
    setLoading(false);

    setTimeout(() => {
      router.push("/dashboard");
    }, 700);
  }

  if (checkingUser) {
    return (
      <main className="min-h-screen bg-[#020817] text-white flex items-center justify-center">
        <p className="text-slate-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#020817] text-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mb-8 text-sm text-blue-400 hover:text-blue-300"
        >
          ← Back to Dashboard
        </button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Business Information</h1>

          <p className="mt-2 text-slate-400">
            Add information about your business so your AI support agent can
            understand your company.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-800 bg-[#111a2e] p-8"
        >
          <div className="mb-6">
            <label className="mb-2 block font-medium">
              Business name
            </label>

            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Example Company"
              className="w-full rounded-xl border border-slate-700 bg-[#020817] px-4 py-3 outline-none focus:border-blue-500"
            />
          </div>

          <div className="mb-6">
            <label className="mb-2 block font-medium">
              Business description
            </label>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us about your business..."
              rows={5}
              className="w-full resize-none rounded-xl border border-slate-700 bg-[#020817] px-4 py-3 outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="mb-2 block font-medium">Email</label>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="support@company.com"
                className="w-full rounded-xl border border-slate-700 bg-[#020817] px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block font-medium">Phone</label>

              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 000 000 0000"
                className="w-full rounded-xl border border-slate-700 bg-[#020817] px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block font-medium">Website</label>

              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://company.com"
                className="w-full rounded-xl border border-slate-700 bg-[#020817] px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block font-medium">Address</label>

              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="City, Country"
                className="w-full rounded-xl border border-slate-700 bg-[#020817] px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {message && (
            <div
              className={`mt-6 rounded-xl border p-4 ${
                message.includes("successfully")
                  ? "border-green-700 bg-green-950/40 text-green-400"
                  : "border-red-700 bg-red-950/40 text-red-400"
              }`}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-8 w-full rounded-xl bg-blue-600 py-3 font-semibold transition hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save Business Information"}
          </button>
        </form>
      </div>
    </main>
  );
}