# Visual Director prompt experiment — Round 2

A short follow-up to the first 20-call experiment. No production code changes.

## Question
Does a simple mandate for exhaustive visual description outperform the more elaborate Visual State Accounting role? Does adding that mandate to C help, or does a shorter instruction work just as well?

## Candidates
- A: unchanged Candidate C baseline from `experiments/visual_director/prompts/C_visual_state_accounting.txt`
- B: generic visual exhaustiveness
- C: Candidate C plus visual exhaustiveness
- D: concise visual exhaustiveness

## Fixtures
Use the original five fixtures from `experiments/visual_director/fixtures/`, plus:
- `fixtures/06_casual_to_evening.json`
- `fixtures/07_denim_look_completion.json`

The Round 2 fashion fixtures deliberately authorize the agent to complete the look. Do not apply Round 1's previous restraint criterion ("do not invent exact garments") to these new tests. The expected behavior is to make plausible, context-grounded creative decisions about the missing visual details, while staying within the Scene's intended scope.

## Execution
Use the existing WebCap Director Chat API, operation `freeform_chat`, with each candidate as an actual `system` message and each fixture as a `user` message. Use the same selected Gemma model and runtime settings for every request. Fresh request per candidate/fixture; no chat history. Reuse the existing queue and GPU ownership. Capture raw outputs and metadata. Never mutate Projects. 4 candidates x 7 fixtures = 28 requests.

If the original candidate C prompt is missing from main, use the exact C text recorded in the Round 1 experiment commit/history; do not rewrite it.

## Evaluation
Prioritize:
1. Visual completeness: did it explicitly establish all important visible details?
2. State transitions: did it replace old visual state rather than accidentally carry it forward?
3. Appropriate completion: did it make sensible choices where the intended visual needs details not supplied?
4. Scope discipline: did it stay within the Scene and avoid inventing a new story?
5. H3 usability: are descriptions concrete and independently renderable?
6. Restraint on the negative control: did it avoid gratuitous changes?

For the fashion fixtures, reward appropriate completion of the outfit. Do not penalize the agent for selecting garments or accessories where the Project/Scene clearly requires a complete new look. Penalize arbitrary narrative additions or choices that contradict the intended style.

Compare actual revised prompts, not explanations. Report candidate scores by fixture, concrete examples, and recommendation. Keep the experiment timeboxed: one run, no iterative prompt tuning.
