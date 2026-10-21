# Transcript checks

Checked on 21 October 2026 against the recovered visible-message records.

| Conversation | Source messages | English messages | Role, ID and order | Protected text checks |
| --- | ---: | ---: | --- | --- |
| Claude planning | 14 | 14 | Match | Pass |
| Claude Code | 138 | 138 | Match | Pass |
| ChatGPT planning/review | 120 | 120 | Match | Pass |
| Total | 272 | 272 | Match | Pass |

For each paired message, checks compared fenced code blocks, inline code, URLs, bin/pallet codes, commit-like identifiers and numeric tokens. All match. Numeric-token checks exclude citation metadata, URLs and code, which have separate preservation checks. No temporary translation-marker residue remains.

These checks establish structural preservation of the recovered snapshot, not semantic perfection of the translation or completeness of material unavailable through the supplied links. Targeted review corrected translation omissions and technical wording; a full human translation audit has not been performed.

The original Markdown files in this package are byte-for-byte copies of the recovered originals. Their hashes appear in SHA256SUMS.txt. Six empty Claude Code session entries are not counted as conversational messages. Claude Code progress remains within Assistant messages, whereas ChatGPT progress is separately labeled.
