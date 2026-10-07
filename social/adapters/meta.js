// Meta adapters: Threads and Instagram (professional account, Instagram API with Instagram Login).
// Both publish in two steps: create a media container, then publish it. Images must be public URLs,
// so they point at the site's own /social/kits/... and /players/... assets.
// Docs: https://developers.facebook.com/docs/threads/posts/ and
//       https://developers.facebook.com/docs/instagram-platform/content-publishing/

async function postForm(f, url, params) {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`meta ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

export const threads = {
  name: "threads",
  configured: (env) => !!(env.THREADS_USER_ID && env.THREADS_ACCESS_TOKEN),
  async post(env, payload, f = fetch) {
    const base = `https://graph.threads.net/${env.THREADS_API_VERSION || "v1.0"}/${env.THREADS_USER_ID}`;
    const token = env.THREADS_ACCESS_TOKEN;
    const ids = [];
    for (let i = 0; i < payload.posts.length; i++) {
      const p = { text: payload.posts[i], access_token: token };
      const img = i === 0 && payload.image_urls && payload.image_urls[0];
      if (img) Object.assign(p, { media_type: "IMAGE", image_url: img });
      else p.media_type = "TEXT";
      if (ids.length) p.reply_to_id = ids[ids.length - 1];
      const c = await postForm(f, `${base}/threads`, p);
      const pub = await postForm(f, `${base}/threads_publish`, { creation_id: c.id, access_token: token });
      ids.push(pub.id);
    }
    return { remote_id: ids[0], ids, count: ids.length };
  },
};

export const instagram = {
  name: "instagram",
  configured: (env) => !!(env.IG_USER_ID && env.IG_ACCESS_TOKEN),
  async post(env, payload, f = fetch) {
    const base = `https://graph.instagram.com/${env.IG_API_VERSION || "v23.0"}/${env.IG_USER_ID}`;
    const token = env.IG_ACCESS_TOKEN;
    const urls = (payload.image_urls || []).slice(0, 10);
    if (!urls.length) throw new Error("instagram needs at least one image");
    let creation;
    if (urls.length === 1) {
      creation = await postForm(f, `${base}/media`, { image_url: urls[0], caption: payload.caption, access_token: token });
    } else {
      const children = [];
      for (const u of urls) {
        const c = await postForm(f, `${base}/media`, { image_url: u, is_carousel_item: "true", access_token: token });
        children.push(c.id);
      }
      creation = await postForm(f, `${base}/media`, {
        media_type: "CAROUSEL", children: children.join(","), caption: payload.caption, access_token: token,
      });
    }
    const pub = await postForm(f, `${base}/media_publish`, { creation_id: creation.id, access_token: token });
    return { remote_id: pub.id, ids: [pub.id], count: 1 };
  },
};
