// Edge Function: check-broken-links
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> tên "check-broken-links" -> dán file này.
// Body (JSON): { "name": "...", "code": "...", "id": 123 }  kiểm tra 1 bản ghi
//              { "name": "...", "code": "...", "limit": 100 } quét tối đa N bản ghi (mặc định 100)
// "name"/"code" là Tên + Mã định danh của người đang đăng nhập (adminmovie.html tự gửi kèm).
// Chỉ tài khoản có user_identities.can_access_movie_admin = true (và chưa bị thu hồi) mới gọi được.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Chặn gọi vào mạng nội bộ (SSRF)
function allowed(u: string): boolean {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    if (h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return false;
    return true;
  } catch { return false; }
}

async function check(row: { url: string; kind: string }) {
  if (!allowed(row.url)) return { status: "broken", http_status: null, error: "URL không hợp lệ / bị chặn" };
  try {
    const res = await fetch(row.url, {
      method: "GET",
      headers: { Range: "bytes=0-2047", "User-Agent": "Mozilla/5.0 (compatible; TVP-LinkChecker/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    let ok = res.status < 400;
    let error: string | null = ok ? null : "HTTP " + res.status;
    if (ok && row.kind === "m3u8") {
      const head = (await res.text()).slice(0, 200);
      if (!head.includes("#EXTM3U")) { ok = false; error = "Không phải playlist m3u8"; }
    } else { await res.body?.cancel(); }
    return { status: ok ? "ok" : "broken", http_status: res.status, error };
  } catch (e) {
    return { status: "broken", http_status: null, error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, service);

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const code = String(body.code || "").trim();
    if (!name || !code) return json({ error: "Thiếu name/code (chưa đăng nhập?)" }, 401);

    const idr = await db.from("user_identities").select("id,can_access_movie_admin,revoked")
      .eq("display_name", name).eq("identity_code", code).eq("revoked", false).maybeSingle();
    if (!idr.data || !idr.data.can_access_movie_admin) return json({ error: "Forbidden" }, 403);
    const actor = String(idr.data.id);

    let rows: any[] = [];
    if (body.id) {
      const r = await db.from("movie_broken_links").select("*").eq("id", body.id);
      rows = r.data ?? [];
    } else {
      // đồng bộ link từ bảng movie_episodes sang movie_broken_links (bỏ qua bản ghi đã có)
      const eps = await db.from("movie_episodes").select("film_slug,episode_name,embed_url,m3u8_url").eq("is_active", true).limit(2000);
      const seeds: any[] = [];
      for (const e of eps.data ?? []) {
        if (e.embed_url) seeds.push({ film_slug: e.film_slug, episode: e.episode_name, kind: "embed", url: e.embed_url });
        if (e.m3u8_url) seeds.push({ film_slug: e.film_slug, episode: e.episode_name, kind: "m3u8", url: e.m3u8_url });
      }
      for (let i = 0; i < seeds.length; i += 200) {
        await db.from("movie_broken_links").upsert(seeds.slice(i, i + 200), { onConflict: "film_slug,episode,kind,url", ignoreDuplicates: true });
      }
      const limit = Math.min(Number(body.limit) || 100, 300);
      const r = await db.from("movie_broken_links").select("*").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(limit);
      rows = r.data ?? [];
    }

    let ok = 0, broken = 0, i = 0;
    const worker = async () => {
      while (i < rows.length) {
        const row = rows[i++];
        const res = await check(row);
        res.status === "ok" ? ok++ : broken++;
        await db.from("movie_broken_links").update({ ...res, last_checked_at: new Date().toISOString(), checked_by: actor }).eq("id", row.id);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return json({ checked: rows.length, ok, broken });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
