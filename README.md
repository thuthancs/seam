# seam - a seamless design and frontend development tool

this is project is built as part of treehacks 2026

## day 1 - direct in-browser editing + ai-assited editing
- Technical challenge: **Bidirectional Tailwind class parser**
- Goal: Should finish this flow EOD
    - Connect → localhost port (auto-detect or user inputs port number)
    - Hover → read className from that exact DOM element
    - Edit → mutate className directly on the DOM (instant preview)
    - Persist → send to dev server → write to source file
- TODO:
    - [x] Write a simple to-do list in React + TypeScript + TailwindCSS
    - Create a chrome extension sidepanel with these key components
        - [x]  `content_script`: *runs inside the user's page*
            - [x]  handles hover detection and DOM manipulation (when hovered on a component, the code snippet that defines the style of that component should be displayed on the sidepanel)
        - [x]  `side_panel`: *a separate React app* that renders your UI. Receives data from the content script via Chrome's messaging API.
        - [x]  `background_service`: the *middleman* that routes messages between content script and sidepanel.
        - [x]  local dev server
    - [ ] Update JSX parser using babel/parser (AST parsing)
    - [ ] Refactor the current code and document learning on 1st day
## day 2 - github integration + collaborative feedback + generate change based on feedback

## learning
- day 1: 

