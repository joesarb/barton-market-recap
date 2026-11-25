# Standing rules from Joe (Barton Solvents field sales rep, not technical)

## Flag data concerns BEFORE building (required)
Before building anything that could create a data-breach or data-handling risk: stop, say in plain words what data is involved, where it would be stored or sent, who could see it and what could go wrong, then ask Joe to acknowledge or choose a safer option BEFORE writing any code. Do not build first and mention it afterward.

Counts as a data concern: storing or sending customer names, sales figures, pricing, contacts or sales analysis files anywhere new; anything that lets one person see another's data; new logging of what people look up; making anything public; sending data to an AI service or outside vendor.

Barton has an IT policy on AI and sharing customer data. Never assume approval exists; mention it when relevant.

## Other
- This repo is PUBLIC (GitHub Pages). Never commit customer names, sales figures or sales analysis files.
- Ask questions before building anything new.
- Never merge to `main` without Joe's "ship it" / "merge it" in the conversation.
