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

### learning
- planning before coding and using ai is an investment, not a waste of time. before the hackathon begins, i already spent sometime in notion and figjam performing some ux flow brainstorm and thinking. i then used claude as a teammate to ask me clarifying questions. i have seen a lot of startups like subframe or inspector showcasing how their products bridge the gap between design and production and i was thinking how to get some inspiration from them. 
    - **current state**: as a design engineer myself, i experienced a pain point in terms of updating the styling of the frontend. i used to update the tailwindcss in code, then open the browser to see the changes and then going back to my ide. i don't like that switching part at all. so i was thinking: how can i make this process more seamless?  
    - **goal state**: i want to edit the styling of components directly in-browser and i want those changes to be updated directly in my codebase without me having to switching tabs. i enjoy this flow because i can see the visual feedback immediately in browser and the fact that the changes have already been applied to the source files saves me time. 
    - **obstacles**: i didn't have much experience with mapping and parsing tailwindcss so i need to ask AI for help with this. i also did not have much experience with creating a custom engine to render a canvas like figma.
    - **scale**: ideally, i would love for this product to reach as many people as possible but for now, i will ask for feedback from 2-3 people.
    - **constraint**: i only have ~2 days to build an MVP to showcase my vision.
- **technical decision**: after analyzing all the aspects above, i decided to choose the tech stack that i'm familiar with and the one that best shows my vision: react, typescript, tailwindcss and chrome extension. 
    - i chose to demo a very simple app (to-do) with a few elements like heading, input, and button.
    - the key reason why i chose chrome extension is the fact that it can read and manipulate the DOM directly. this helps me extract the styling data from the browser and send it back to the server so that it can update the source files directly.
    - for a demo, i don't aim for the most generalizable app so i stick to the opinionated combo of react, typescript, and tailwind.
- **result**: i was able to ship a working demo in 4 hours
- **knowledge gaps**:
    - ast parsing with babel
    - es model patterns
    - extension architecture/workflow

https://www.loom.com/share/1790c5b7d40048f0b1b8a56868aff617

## day 2 - github integration + collaborative feedback + generate changes based on feedback (AI)
- [ ] Add an AI feature to update the design of the component (using OpenAI and Claude)
    Basically, I can prompt AI to change the style of the current html element
- [ ] Add an AI feature to change the design of the whole page. This means they can use some preset shortcuts to change the whole brand of the page (e.g., modern minimalism, retro, etc.) with reference URLs.
- [ ] Integrate with GitHub to create a PR after all the changes
- [ ] Test the whole flow: render the app in a browser -> edit the style in-browser -> apply the changes -> source code is updated -> create a PR directly to the GitHub repo of the project
- [ ] Add collaborative feedback feature where user can add comment on the page
- [ ] Add an AI feature where AI reads all the feedback and suggest changes for the style of the app

## day 3 - polish and demo

