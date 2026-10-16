import { useEffect, useState } from "react";
import {
  api,
  errorText,
  native,
  workspace,
  type SearchResult,
  type Vault,
} from "./api";

/** Search owns its filters and ignores responses after a filter or vault change. */
export function useNoteSearch(
  vault: Vault | null,
  revision: number,
  onError: (message: string) => void,
) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [directory, setDirectory] = useState("");
  const [filenameOnly, setFilenameOnly] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  function clearSearch() {
    setQuery("");
    setTag("");
    setDirectory("");
    setFilenameOnly(false);
    setResults(null);
  }
  useEffect(() => {
    let active = true;
    if (!query.trim() && !tag && !directory) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      const request = native
        ? workspace<SearchResult>({
            action: "search",
            query,
            directory,
            tag,
            filenameOnly,
          })
        : api.search(query, directory);
      request
        .then((result) => {
          if (active) setResults(result);
        })
        .catch((error) => {
          if (active) onError(errorText(error));
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, tag, directory, filenameOnly, revision, vault, onError]);
  return {
    query,
    setQuery,
    tag,
    setTag,
    directory,
    setDirectory,
    filenameOnly,
    setFilenameOnly,
    results,
    clearSearch,
  };
}
