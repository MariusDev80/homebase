//! Shortcut commands: port of `sqlite-shortcut.repository.spec.ts` and of the shortcut cases of
//! `sqlite-search.spec.ts`, plus the cases of 4.11 (DTO, T7, timestamps, validation before the
//! disk).

use super::support::{uid, Fixture, T0};
use crate::backup::test_support::run;
use crate::data::error::DataError;
use crate::data::shortcuts::{
    create_shortcut, delete_shortcut, list_shortcuts, reorder_shortcuts, search_shortcuts,
    update_shortcut, ShortcutDto, ShortcutNewDto,
};

const MISSING: u32 = 0xff;
const OK_URL: &str = "https://a.example/";

fn new(id: u32, label: &str, url: &str) -> ShortcutNewDto {
    ShortcutNewDto {
        id: uid(id),
        label: label.to_owned(),
        url: url.to_owned(),
    }
}

fn add(f: &Fixture, id: u32, label: &str, url: &str) -> ShortcutDto {
    run(create_shortcut(&f.ctx, &new(id, label, url))).expect("create")
}

fn labels(f: &Fixture) -> Vec<String> {
    run(list_shortcuts(&f.ctx))
        .expect("list")
        .into_iter()
        .map(|s| s.label)
        .collect()
}

fn found(f: &Fixture, query: &str, limit: u32) -> Vec<String> {
    run(search_shortcuts(&f.ctx, query, limit))
        .expect("search")
        .into_iter()
        .map(|s| s.label)
        .collect()
}

fn reorder(f: &Fixture, ids: &[u32]) -> Result<(), DataError> {
    let ids: Vec<String> = ids.iter().map(|n| uid(*n)).collect();
    run(reorder_shortcuts(&f.ctx, &ids))
}

fn insert_sql(label: &str, url: &str, sort_order: i64) -> String {
    format!(
        "INSERT INTO shortcuts (id, label, url, sort_order, created_at, updated_at)
         VALUES ('{}', '{label}', '{url}', {sort_order}, '{T0}', '{T0}')",
        uid(1)
    )
}

/// TS: "V2 shortcuts table: accepts http and https URLs and a label of 80 characters".
#[test]
fn accepts_http_and_https_urls_and_a_label_of_80_characters() {
    let f = Fixture::create();
    add(&f, 1, "A", "https://example.com/");
    add(&f, 2, "B", "http://example.com/");
    add(&f, 3, &"x".repeat(80), "https://example.com/");
    assert_eq!(labels(&f).len(), 3);
}

/// TS: "refuses the URL ..." (it.each of 5 URLs) and "refuses a URL longer than 2048
/// characters": by the command (`invalid_input`, before the disk) and by the table (the safety
/// net).
#[test]
fn refuses_urls_that_are_not_http_or_are_too_long() {
    let f = Fixture::create();
    let offline = f.without_disk();
    let too_long = format!("https://e.com/{}", "a".repeat(2048));
    for url in [
        "javascript:alert(1)",
        "file:///C:/Windows/system32/cmd.exe",
        "data:text/html,hi",
        "ftp://example.com/",
        "example.com",
        // Case-sensitive, like `/^https?:\/\//`.
        "HTTPS://example.com/",
        too_long.as_str(),
    ] {
        assert_eq!(
            run(create_shortcut(&offline, &new(1, "A", url))),
            Err(DataError::invalid("url")),
            "{url}"
        );
        assert_eq!(
            run(update_shortcut(&offline, &uid(1), "A", url)),
            Err(DataError::invalid("url")),
            "{url}"
        );
    }
    for url in [
        "javascript:alert(1)",
        "file:///C:/Windows/system32/cmd.exe",
        "data:text/html,hi",
        "ftp://example.com/",
        "example.com",
        too_long.as_str(),
    ] {
        assert!(f.exec_fails(&insert_sql("A", url, 0)), "{url}");
    }
    assert!(labels(&f).is_empty());
    // 2 048 units pass.
    let max = format!("https://e.com/{}", "a".repeat(2048 - 14));
    add(&f, 2, "A", &max);
}

/// TS: "refuses an empty or blank label and a label of 81 characters" (table) and "refuses a
/// negative sort_order" (table).
#[test]
fn the_table_check_is_the_safety_net_for_label_and_order() {
    let f = Fixture::create();
    assert!(f.exec_fails(&insert_sql("", "https://e.com/", 0)));
    assert!(f.exec_fails(&insert_sql("   ", "https://e.com/", 0)));
    assert!(f.exec_fails(&insert_sql(&"x".repeat(81), "https://e.com/", 0)));
    assert!(f.exec_fails(&insert_sql("A", "https://e.com/", -1)));
    assert!(!f.exec_fails(&insert_sql("A", "https://e.com/", 0)));
}

/// TS: "creates with increasing sort_order and trims the label".
#[test]
fn creates_with_increasing_sort_order_and_trims_the_label() {
    let f = Fixture::create();
    let a = add(&f, 1, "  A  ", OK_URL);
    let b = add(&f, 2, "B", "http://b.example/");
    assert_eq!(
        a,
        ShortcutDto {
            id: uid(1),
            label: "A".to_owned(),
            url: OK_URL.to_owned(),
            sort_order: 0,
            created_at: T0.to_owned(),
            updated_at: T0.to_owned(),
        }
    );
    assert_eq!(b.sort_order, 1);
}

/// TS: "lists by sort_order then created_at".
#[test]
fn lists_by_sort_order_then_created_at() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    add(&f, 2, "B", OK_URL);
    add(&f, 3, "C", OK_URL);
    assert_eq!(labels(&f), ["A", "B", "C"]);
    f.exec(
        "UPDATE shortcuts SET sort_order = 0, created_at = '2025-01-01T00:00:00.000Z'
         WHERE label = 'C'",
    );
    assert_eq!(labels(&f), ["C", "A", "B"]);
}

/// TS: "gives a new shortcut the maximum sort_order + 1 after a removal".
#[test]
fn gives_a_new_shortcut_the_maximum_sort_order_plus_one_after_a_removal() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    add(&f, 2, "B", OK_URL);
    assert_eq!(run(delete_shortcut(&f.ctx, &uid(1))), Ok(true));
    let c = add(&f, 3, "C", OK_URL);
    assert_eq!(c.sort_order, 2);
    assert_eq!(labels(&f), ["B", "C"]);
}

/// TS: "updates label and url, keeping sort_order and created_at".
#[test]
fn updates_label_and_url_keeping_sort_order_and_created_at() {
    let f = Fixture::create();
    let a = add(&f, 1, "A", OK_URL);
    f.at("2026-02-02T00:00:00.000Z");
    let updated = run(update_shortcut(
        &f.ctx,
        &uid(1),
        " Z ",
        "https://z.example/",
    ))
    .expect("update");
    assert_eq!(
        updated,
        ShortcutDto {
            label: "Z".to_owned(),
            url: "https://z.example/".to_owned(),
            updated_at: "2026-02-02T00:00:00.000Z".to_owned(),
            ..a
        }
    );
}

/// TS: "update throws not_found when absent".
#[test]
fn update_is_not_found_when_absent() {
    let f = Fixture::create();
    assert_eq!(
        run(update_shortcut(&f.ctx, &uid(MISSING), "A", OK_URL)),
        Err(DataError::NotFound)
    );
    assert_eq!(
        run(update_shortcut(&f.ctx, "../etc", "A", OK_URL)),
        Err(DataError::NotFound)
    );
}

/// TS: "refuses invalid fields with invalid_input" (nothing is written), plus the malformed id
/// of 4.9 item 1 and a duplicate id (L1).
#[test]
fn refuses_invalid_fields_with_invalid_input() {
    let f = Fixture::create();
    let offline = f.without_disk();
    assert_eq!(
        run(create_shortcut(&offline, &new(1, " ", OK_URL))),
        Err(DataError::invalid("label"))
    );
    assert_eq!(
        run(create_shortcut(&offline, &new(1, &"x".repeat(81), OK_URL))),
        Err(DataError::invalid("label"))
    );
    assert_eq!(
        run(create_shortcut(
            &offline,
            &new(1, "A", "javascript:alert(1)")
        )),
        Err(DataError::invalid("url"))
    );
    let bad_id = ShortcutNewDto {
        id: "nope".to_owned(),
        ..new(1, "A", OK_URL)
    };
    assert_eq!(
        run(create_shortcut(&offline, &bad_id)),
        Err(DataError::invalid("id"))
    );
    assert!(labels(&f).is_empty());
    add(&f, 1, "A", OK_URL);
    assert_eq!(
        run(create_shortcut(&f.ctx, &new(1, "B", OK_URL))),
        Err(DataError::Conflict)
    );
    // Label of 80 units passes, 81 does not; a tab-only label is blank.
    add(&f, 2, &"x".repeat(80), OK_URL);
    assert_eq!(
        run(create_shortcut(&offline, &new(3, "\t\n", OK_URL))),
        Err(DataError::invalid("label"))
    );
}

/// TS: "remove returns true then false".
#[test]
fn delete_returns_true_then_false() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    assert_eq!(run(delete_shortcut(&f.ctx, &uid(1))), Ok(true));
    assert_eq!(run(delete_shortcut(&f.ctx, &uid(1))), Ok(false));
}

/// TS: "reorders according to the given ids".
#[test]
fn reorders_according_to_the_given_ids() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    add(&f, 2, "B", OK_URL);
    add(&f, 3, "C", OK_URL);
    reorder(&f, &[3, 1, 2]).expect("reorder");
    assert_eq!(labels(&f), ["C", "A", "B"]);
    let orders: Vec<i64> = run(list_shortcuts(&f.ctx))
        .expect("list")
        .iter()
        .map(|s| s.sort_order)
        .collect();
    assert_eq!(orders, [0, 1, 2]);
}

/// TS: "reorder ignores unknown ids and does nothing for an empty batch" (the empty batch does
/// not even open the database).
#[test]
fn reorder_ignores_unknown_ids_and_does_nothing_for_an_empty_batch() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    add(&f, 2, "B", OK_URL);
    assert_eq!(run(reorder_shortcuts(&f.without_disk(), &[])), Ok(()));
    reorder(&f, &[]).expect("empty");
    reorder(&f, &[MISSING, 2, 1]).expect("reorder");
    assert_eq!(labels(&f), ["B", "A"]);
    let list = run(list_shortcuts(&f.ctx)).expect("list");
    assert_eq!(list[0].sort_order, 1);
    assert_eq!(list[1].sort_order, 2);
}

/// TS: "reorder rejects duplicate ids before any change" and "rejects more than 1000 ids".
#[test]
fn reorder_rejects_duplicates_and_oversized_batches_before_the_disk() {
    let f = Fixture::create();
    let offline = f.without_disk();
    let a = uid(1);
    assert_eq!(
        run(reorder_shortcuts(&offline, &[a.clone(), a])),
        Err(DataError::invalid("ids"))
    );
    let many: Vec<String> = (0..1001).map(|i| format!("id-{i}")).collect();
    assert_eq!(
        run(reorder_shortcuts(&offline, &many)),
        Err(DataError::invalid("ids"))
    );
    // 1 000 distinct ids are accepted.
    let ok: Vec<String> = (0..1000).map(|i| format!("id-{i}")).collect();
    assert_eq!(run(reorder_shortcuts(&f.ctx, &ok)), Ok(()));
}

/// TS: "reorder only touches rows whose sort_order changes".
#[test]
fn reorder_only_touches_rows_whose_sort_order_changes() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    add(&f, 2, "B", OK_URL);
    add(&f, 3, "C", OK_URL);
    f.at("2026-03-03T00:00:00.000Z");
    reorder(&f, &[1, 3, 2]).expect("reorder");
    let list = run(list_shortcuts(&f.ctx)).expect("list");
    let stamp = |label: &str| {
        list.iter()
            .find(|s| s.label == label)
            .map(|s| s.updated_at.clone())
            .expect("shortcut")
    };
    assert_eq!(stamp("A"), T0);
    assert_eq!(stamp("B"), "2026-03-03T00:00:00.000Z");
    assert_eq!(stamp("C"), "2026-03-03T00:00:00.000Z");
}

/// TS (search): "matches label or url, ASCII case-insensitively, label matches first".
#[test]
fn search_matches_label_or_url_label_first() {
    let f = Fixture::create();
    add(&f, 1, "Docs", "https://example.com/angular");
    add(&f, 2, "Angular", "https://angular.dev");
    add(&f, 3, "Autre", "https://autre.org");
    assert_eq!(found(&f, "ANGULAR", 10), ["Angular", "Docs"]);
}

/// TS (search): "finds %, _ and \ literally".
#[test]
fn search_finds_wildcards_literally() {
    let f = Fixture::create();
    add(&f, 1, "100% pur", "https://a.test/1");
    add(&f, 2, "snake_case", "https://a.test/2");
    add(&f, 3, "plain", "https://a.test/3?p=c:\\dir");
    add(&f, 4, "abcd", "https://a.test/4");
    assert_eq!(found(&f, "%", 10), ["100% pur"]);
    assert_eq!(found(&f, "_", 10), ["snake_case"]);
    assert_eq!(found(&f, "\\", 10), ["plain"]);
    assert!(found(&f, "a_c", 10).is_empty());
}

/// TS (search): "honours the limit and sort order".
#[test]
fn search_honours_the_limit_and_sort_order() {
    let f = Fixture::create();
    for n in 1..=4 {
        add(&f, n, &format!("site {n}"), &format!("https://s.test/{n}"));
    }
    assert_eq!(found(&f, "site", 2), ["site 1", "site 2"]);
}

/// TS (search): "validates query and limit" (before the disk).
#[test]
fn search_validates_query_and_limit() {
    let f = Fixture::create();
    let offline = f.without_disk();
    for query in ["", "   ", &"x".repeat(201)] {
        assert_eq!(
            run(search_shortcuts(&offline, query, 5)),
            Err(DataError::invalid("query"))
        );
    }
    for limit in [0, 21] {
        assert_eq!(
            run(search_shortcuts(&offline, "x", limit)),
            Err(DataError::invalid("limit"))
        );
    }
    // 1.5 is refused by the deserialization of the `u32` argument (S2).
    assert!(serde_json::from_value::<u32>(serde_json::json!(1.5)).is_err());
    assert!(serde_json::from_value::<u32>(serde_json::json!(-1)).is_err());
    assert!(run(search_shortcuts(&f.ctx, " x ", 20)).is_ok());
    assert!(run(search_shortcuts(&f.ctx, &"x".repeat(200), 1)).is_ok());
}

/// TS (search): "is not vulnerable to quotes in the query".
#[test]
fn search_is_not_vulnerable_to_quotes() {
    let f = Fixture::create();
    add(&f, 1, "it's", "https://a.test");
    assert!(found(&f, "'; DROP TABLE shortcuts; --", 5).is_empty());
    assert_eq!(found(&f, "it's", 5).len(), 1);
}

/// T7: every write is `unavailable`, nothing changes; reads work.
#[test]
fn writes_are_unavailable_when_a_restoration_is_staged() {
    let f = Fixture::create();
    add(&f, 1, "A", OK_URL);
    let ro = f.read_only();
    assert_eq!(
        run(create_shortcut(&ro, &new(2, "B", OK_URL))),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_shortcut(&ro, &uid(1), "Z", OK_URL)),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(delete_shortcut(&ro, &uid(1))),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(reorder_shortcuts(&ro, &[uid(1)])),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(reorder_shortcuts(&ro, &[])),
        Err(DataError::Unavailable)
    );
    assert_eq!(labels(&f), ["A"]);
    assert_eq!(run(list_shortcuts(&ro)).expect("list").len(), 1);
    assert_eq!(run(search_shortcuts(&ro, "a", 5)).expect("search").len(), 1);
}

/// Timestamps come from the injected clock.
#[test]
fn timestamps_come_from_the_injected_clock() {
    let f = Fixture::create();
    f.at("2031-07-08T09:10:11.012Z");
    let s = add(&f, 1, "A", OK_URL);
    assert_eq!(s.created_at, "2031-07-08T09:10:11.012Z");
    assert_eq!(s.updated_at, "2031-07-08T09:10:11.012Z");
}

/// DTO: camelCase exact, unknown field refused.
#[test]
fn shortcut_dtos_are_camel_case_and_the_input_refuses_unknown_fields() {
    let f = Fixture::create();
    let s = add(&f, 1, "A", OK_URL);
    assert_eq!(
        serde_json::to_value(&s).expect("json"),
        serde_json::json!({
            "id": uid(1), "label": "A", "url": OK_URL, "sortOrder": 0,
            "createdAt": T0, "updatedAt": T0
        })
    );
    let ok = serde_json::json!({ "id": uid(2), "label": "B", "url": OK_URL });
    assert!(serde_json::from_value::<ShortcutNewDto>(ok.clone()).is_ok());
    let mut extra = ok;
    extra["extra"] = serde_json::json!(true);
    assert!(serde_json::from_value::<ShortcutNewDto>(extra).is_err());
}
