//! Wikilink title extraction / rewrite for the derived `links` index (ENG-56).

/// Titles inside `[[…]]`, in document order. Skips empty / multiline and `[[task:…]]`.
pub fn extract_wikilink_titles(body: &str) -> Vec<String> {
    let mut titles = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            if let Some(rel) = body[start..].find("]]") {
                let raw = &body[start..start + rel];
                i = start + rel + 2;
                let title = raw.trim();
                if title.is_empty() || title.contains('\n') {
                    continue;
                }
                // Reserved for ENG-61 task pills.
                if title.len() >= 5 && title[..5].eq_ignore_ascii_case("task:") {
                    continue;
                }
                titles.push(title.to_string());
                continue;
            }
        }
        i += 1;
    }
    titles
}

/// Replace `[[old_title]]` with `[[new_title]]` when the inner title matches exactly (trimmed).
pub fn rewrite_wikilink_title(body: &str, old_title: &str, new_title: &str) -> String {
    if old_title == new_title {
        return body.to_string();
    }
    let mut out = String::with_capacity(body.len());
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            if let Some(rel) = body[start..].find("]]") {
                let raw = &body[start..start + rel];
                if raw.trim() == old_title {
                    out.push_str("[[");
                    out.push_str(new_title);
                    out.push_str("]]");
                    i = start + rel + 2;
                    continue;
                }
            }
        }
        out.push(body[i..].chars().next().unwrap());
        i += body[i..].chars().next().unwrap().len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_titles_and_skips_task_pills() {
        let body = "See [[Weekly Review]] and [[foo]].\n[[task:abc]] Buy milk\n[[  Bar  ]]";
        assert_eq!(
            extract_wikilink_titles(body),
            vec!["Weekly Review", "foo", "Bar"]
        );
    }

    #[test]
    fn rewrite_updates_matching_titles_only() {
        let body = "[[Alpha]] and [[Alpha Beta]] and [[Alpha]]";
        assert_eq!(
            rewrite_wikilink_title(body, "Alpha", "Omega"),
            "[[Omega]] and [[Alpha Beta]] and [[Omega]]"
        );
    }
}
