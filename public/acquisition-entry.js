// A short-lived capability stays only in this page's memory. No cookies or
// storage are used to identify anonymous visitors across visits.
export async function enrollmentAcquisition({ mode, slug, search, api }) {
  const params = new URLSearchParams(search);
  const source = params.get('origen');
  if (mode !== 'register' || params.getAll('origen').length !== 1 || !/^[A-Za-z0-9_-]{16}$/.test(source || '')) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await api(`/api/public/business/${slug}/acquisition/visit`, {
      method: 'POST', signal: controller.signal, body: JSON.stringify({ source_code: source })
    });
    return /^[A-Za-z0-9_-]{43}$/.test(response?.visit_token || '') ? { visitToken: response.visit_token } : {};
  } catch { return {}; }
  finally { clearTimeout(timer); }
}
