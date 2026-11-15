export const THEME_KEY = "folio-theme";

/** Runs before paint so a saved choice never flashes the other theme. With no choice yet, Folio opens dark. */
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;
