// src/lib/urlState.js — a list's filter, sort and page state kept in the URL's query string, so refresh, Back and
// a shared link reproduce the same list. The initial state comes from the current URL; every change rewrites the
// query in place (no history entry per keystroke).
import { useCallback, useEffect, useState } from "react";
import { currentSearch, decodeQuery, encodeQuery, replaceSearch } from "./router.js";

export function useUrlState(defaults) {
  const [state, setStateRaw] = useState(() => decodeQuery(currentSearch(), defaults));
  useEffect(() => { replaceSearch(encodeQuery(state, defaults)); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const setState = useCallback(next => setStateRaw(prev => {
    const v = typeof next === "function" ? next(prev) : next;
    // Any filter change goes back to page 1 unless the change is the page itself.
    const filtersChanged = Object.keys(v).some(k => k !== "page" && String(v[k]) !== String(prev[k]));
    return filtersChanged && v.page === prev.page ? { ...v, page: 1 } : v;
  }), []);
  const search = encodeQuery(state, defaults);
  return [state, setState, search];
}
