# Expense Tracker

#workbench

There’ll be users obviously

## Goal

Goal is to build an app which handles splitting amongst friends AND expense categorization. No app afaik does that.

==The reason it’s not a webapp - I want to keep background processes like categorization and parsing screenshots running. Not sure if it’s possible in a PWA. also many of the gesture features I want won’t be possible I guess.==

**User**

- id
- name
- phone
- has_user_himself_onboarded_yet: boolean

**Imports**

- id
- user_id -> when a user imports someone from their contact, we make them a new user who have `has_user_himself_onboarded_yet` false, without a name.
- imported_by -> id of user who imported user_id
- alias -> name in contacts of user who imported, used to show till user_id himself onboards the app

Unsolved Problem -> Let’s say I import Harsh into the app. I have his contact saved as “Chaman”. Now, deepika imports him too , she has him named “Sikriwal”. How would that work. That’ll be two imports then pointing to same user_id? Hmm.

**Expenses**

- id
- by -> fk to user
- amount - string
- paid_at
- notes
- screenshot
- attachments - photo of bills, pdf etc
- tags - list of tag ids.

Unsolved question -> where do tags come from? A bunch of users need shared tags. Because say I import Harsh into the app and add him in some expenses which are tagged `grocery`, then that also counts towards his expenses in `grocery` . hmm.
but tags only remaining within a group of people sounds like a complex idea. Ok, I think tags should be global entities i.e one user creates them and then everyone can use them. when user uploads an expense we’ll have some suggested tags for them. if they start typing something we can show them similar ones. if they still create a new one, we’ll add it to global list. What if someone wants to tag their expense ‘trip 2026’ . hmmmm. this tells me there should be a global admin only list of tags, and rest of it should be upto users.

**Tags**

- id
- tag - string
- created_by - user_id (if created by some user, how should we differentiate admin created tags?)

**Splits**

- id
- expense_id
- user_id
- amount

Constraint -> sum of all split amounts for a given expense_id should equal expense’s amount.

Unsolved Problem -> If someone imports a user from the contact number they have, but when the actual user comes to the app he has a different number.

Feature for later -> Let a user upload an expense from someone else’s behalf

Unsolved Problem -> I usually split expense with Hriju but will never ask him for money back. So that’s still money gone from my account but the split needs to include him
Solution: That’s still my expense and not Hriju’s expense. So I won’t include hriju in it.

Unsolved Problem -> Sometimes one expense encompasses multiple tags which should ideally be divided into multiple expenses. for example, if we order groceries and scissors from blinkit they are ideally two expenses. Hmm. The first solution that comes to mind is that there should be extremely easy UX for splitting the expense. Second, AI should auto suggest splitting

Let’s think of screens/UX then?

The core UX is me uploading screenshots of gpay transactions to the app. It parses, puts suggested tags etc in the background. When I return to the app all that’s remaining for me is to split and approve tags.

I’m stuck on problem that what should screens look like? let’s start with primary screen. As soon as I land on app I’d want to know how much I’ve spent since the 1st of current month. A screen should show who ows me how much. A screen with graphs and visualizations.

Feature -> allow user to dictate by voice on how to split.
Feature -> an in app AI should be able to fiddle with primitives of the app, so that when user orders that AI to do something, it can do that in the app on behalf of user. i.e make it so that AI is one of the users of the app.

#### 13 Jun 2026 at 5:28 PM

I’m stuck on where to start the app from? Ok. let’s start thinking from - If I were to use this app from tomorrow onwards, what would I want. I would want to upload a screenshot. AI does the parsing for me and fills in the details.

When I go to the app, there’s a list of entries which shows the screenshots and their state. It can be pending (they are in the queue waiting to be filled in), split pending or done.

How do I make it so that an AI can also operate on this? Well, an AI will be able to use the tools, the tools can add things in db just like a user does.

Ok, got distracted, the MVP

## MVP

1. User uploads screenshot of a transaction in gpay.
2. The app shows them as a list with “Details pending to be filled in”
3. Once details are filled in, it’ll be in “split pending” state
4. Then user can click on the expense, add friends to split by importing them using contacts.
5. He can add some of the predefined tags. Some tags are suggested by the AI itself.

Ok, good enough feature set to build then.

I can start with Ignite - [infinitered/ignite: Infinite Red's battle-tested React Native project boilerplate, along with a CLI, component/model generators, and more! 9 years of continuous development and counting.](https://github.com/infinitered/ignite)

This also needs rethinking of this schema
**Expenses**

- id
- by -> fk to user
- amount - string
- paid_at
- notes
- screenshot
- state - “enrichment_pending” | “split_pending” | “complete”

**Expense-Tag**

- id
- expense_id
- tag_id

**Tag_suggestions**

- expense_id
- tag_id

when the state is “enrichment_pending”, there’ll just be a screenshot, the amount, paid_at, notes would be empty. Also there’ll be no tags and splits corresponding to this expense. (Need to build that constraint in the db itself). if the state is “split_pending”, then the amount, paid_at should be filled in. notes can be empty optionally.
