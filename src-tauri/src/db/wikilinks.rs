//! Note-link title extraction / rewrite for the derived `links` index (ENG-56/57).
//! Covers `[[wikilinks]]`, `#tags`, and `@mentions` (same note namespace).

fn is_wordy_before(bytes: &[u8], i: usize) -> bool {
    if i == 0 {
        return false;
    }
    let prev = bytes[i - 1];
    prev.is_ascii_alphanumeric() || prev == b'_' || prev == b'@'
}

fn is_tag_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

fn is_tag_title(title: &str) -> bool {
    !title.is_empty() && title.bytes().all(is_tag_char)
}

fn is_mention_title(title: &str) -> bool {
    let bytes = title.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    // First token: [A-Za-z][\w-]*
    let mut i = 1;
    while i < bytes.len() && is_tag_char(bytes[i]) {
        i += 1;
    }
    if i == bytes.len() {
        return true;
    }
    // Optional " Surname": space + [A-Z][\w-]*
    if bytes[i] != b' ' || i + 1 >= bytes.len() || !bytes[i + 1].is_ascii_uppercase() {
        return false;
    }
    i += 2;
    while i < bytes.len() && is_tag_char(bytes[i]) {
        i += 1;
    }
    i == bytes.len()
}

fn scan_tag_title(body: &str, start: usize) -> Option<&str> {
    let bytes = body.as_bytes();
    let mut end = start;
    while end < bytes.len() && is_tag_char(bytes[end]) {
        end += 1;
    }
    if end == start {
        return None;
    }
    Some(&body[start..end])
}

fn scan_mention_title(body: &str, start: usize) -> Option<&str> {
    let bytes = body.as_bytes();
    if start >= bytes.len() || !bytes[start].is_ascii_alphabetic() {
        return None;
    }
    let mut end = start + 1;
    while end < bytes.len() && is_tag_char(bytes[end]) {
        end += 1;
    }
    // Optional capitalized surname token.
    if end + 1 < bytes.len() && bytes[end] == b' ' && bytes[end + 1].is_ascii_uppercase() {
        end += 2;
        while end < bytes.len() && is_tag_char(bytes[end]) {
            end += 1;
        }
    }
    Some(&body[start..end])
}

/// Titles from `[[…]]`, `#tag`, and `@mention`, in document order.
/// Skips empty / multiline wikilinks and `[[task:…]]`.
pub fn extract_wikilink_titles(body: &str) -> Vec<String> {
    let mut titles = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'[' && bytes[i + 1] == b'[' {
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

        if bytes[i] == b'#' && !is_wordy_before(bytes, i) {
            if let Some(title) = scan_tag_title(body, i + 1) {
                titles.push(title.to_string());
                i += 1 + title.len();
                continue;
            }
        }

        if bytes[i] == b'@' && !is_wordy_before(bytes, i) {
            if let Some(title) = scan_mention_title(body, i + 1) {
                titles.push(title.to_string());
                i += 1 + title.len();
                continue;
            }
        }

        i += 1;
    }
    titles
}

/// Replace `[[old]]` / `#old` / `@old` when the captured title matches exactly.
/// Tag/mention shorthand rewrites only when both titles still fit that syntax.
pub fn rewrite_wikilink_title(body: &str, old_title: &str, new_title: &str) -> String {
    if old_title == new_title {
        return body.to_string();
    }
    let rewrite_tag = is_tag_title(old_title) && is_tag_title(new_title);
    let rewrite_mention = is_mention_title(old_title) && is_mention_title(new_title);
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

        if rewrite_tag && bytes[i] == b'#' && !is_wordy_before(bytes, i) {
            if let Some(title) = scan_tag_title(body, i + 1) {
                if title == old_title {
                    out.push('#');
                    out.push_str(new_title);
                    i += 1 + title.len();
                    continue;
                }
            }
        }

        if rewrite_mention && bytes[i] == b'@' && !is_wordy_before(bytes, i) {
            if let Some(title) = scan_mention_title(body, i + 1) {
                if title == old_title {
                    out.push('@');
                    out.push_str(new_title);
                    i += 1 + title.len();
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
    fn extracts_tags_and_mentions_same_namespace() {
        let body = "See [[project]] and #project with @Priya Sharma and user@email.com";
        assert_eq!(
            extract_wikilink_titles(body),
            vec!["project", "project", "Priya Sharma"]
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

    #[test]
    fn rewrite_updates_tags_and_mentions() {
        let body = "#Alpha and @Priya Sharma and #Alpha-x and @Priya";
        assert_eq!(
            rewrite_wikilink_title(body, "Alpha", "Omega"),
            "#Omega and @Priya Sharma and #Alpha-x and @Priya"
        );
        assert_eq!(
            rewrite_wikilink_title(body, "Priya Sharma", "Ada Lovelace"),
            "#Alpha and @Ada Lovelace and #Alpha-x and @Priya"
        );
    }
}
