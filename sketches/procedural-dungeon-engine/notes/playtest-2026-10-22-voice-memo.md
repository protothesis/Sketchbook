# Dungeon game layer: lantern, ghosts, entropy, and fast travel (voice memo)

Transcript of a solo voice memo (about 31 minutes, recorded Oct 22, 2026) with closing playtest thoughts on the game layer of a procedural dungeon generator: the lantern, ghosts, pixies in jars, entropy, waystones, and fast travel. Edited from a machine transcript: filler words, false starts and self-corrections removed, sentences broken by thinking pauses rejoined. Section headings and [bracketed notes] were added by the editor. Mishearings fixed from context: "waste stone", "waste on", "wasted downs" are waystones; "respond" is respawn; "lay lines" is ley lines. Where the speaker says both "waypoint" and "waystone," the wording is kept as spoken.

## Lantern particles and dither overlay (00:02)

These are closing thoughts on the dungeon generator's game layer, after briefly playtesting the most recent changes.

First, the lantern. The particles looked pretty good while the figure was moving, but when the character was sitting idle or standing they seemed too random, more like sparks. I'd like them to behave more like a flame, or wisps of embers.

The dither overlay missed the mark a little. What I really want is a semi-transparent, stylized circle around the lantern. The dither is very noisy, and I think it starts too small. The overall behavior is correct, in that it shrinks and changes size; it's the way it looks that isn't right. Is there another way we could get that transparency?

## The lamp as a timer (01:49)

Moving on to gameplay. I think the lamp as a timer is pretty good: it forces a different way of playing and interacting with the space, which I like. But in my runs it was relatively easy to get a full meter and keep it full.

That changed the pacing from deliberate, cautious exploration to a hurried "run down the freaking halls and look for the resources" style of play. I'd want something in between, leaning toward the slower side. I don't know the solution yet; it's just a feel note.

## Waypoint rooms and room shapes (03:09)

Placing the waypoint rooms much farther apart is a lot better, and it's probably close to right. It might feel even better, except that I ran into a couple of big rooms that weren't waypoints, which broke up the pacing and made waypoint rooms feel less rare and special. We probably need to lower the odds of those random big rooms if we keep them in the engine's generation.

I do like their shape, though. They're much more irregular, whereas most of the ["seed" rooms, unclear] to begin with have been pretty much all boxes and rectangles.

I've wanted to revisit the underlying engine, the room generation, and the room archetypes, but that has felt like a separate engine pass compared to our recent focus on gameplay feel. So the question is whether to split those into separate tasks, or to be looser and explore both at the same time.

## Ghosts as lingering threats (04:56)

In general the dungeon feels very empty of life, and at some point the ghosts started feeling very rare. I've decided not to use the trap-ghosts-in-a-jar idea because it's totally overpowered. Ghosts went from a serious threat that you had to manage with stealth to something you could lure into an easy trap with your light. There's something cool about it, but let's not use it for ghosts.

I'll come back to that, because I have an idea. For now, sticking with ghosts: other than closing a door on a room that has a ghost, I'm starting to think it's best to keep them around as lingering, constant threats you have to manage. They're one of the few things that force you to slow down and think about where you're moving and how you're positioned. I like that feeling, and I want to think of other ways to make the player slow down and think in non-combat ways.

Maybe you can't reroll a room as long as there's a ghost inside it. That may be a little extreme, but I think there's something to it.

## Consequences for ghost contact (07:28)

I also want to talk about consequences. Right now, being touched by a ghost only causes visual glitchiness. But now that the lantern can run out and respawn you at your most recent waystone, I think there could be a much more serious consequence. If a ghost touches you and you don't get out of its glitch radius within a short time, that should probably respawn you too. It's not quite death. I originally thought there would be no death, but I'm starting to think some more significant consequences are a good idea.

The problem with respawning on contact is that you can walk through a door and collide with a ghost with no chance to react, especially with the push-to-open door controls: you slide right in and boom. This has happened to me in the little one-room dead ends we've started calling closets. I walked into a closet, a ghost was there, and there was no way to avoid it. You'd take damage immediately, and it would not be fun to open a door and be sent straight back to your waystone.

There may be a way to make that work, but for now I want to sidestep it, and not by banning ghosts from closets or creating a pile of rules about where they can be placed.

## A psychic stamina meter (09:54)

We could give the player a kind of psychic meter [heard as "psychology"], and maybe it could work in tandem with the lamp running out. Here's the pitch as it's coming together: a "psychic stamina" that is basically a health bar. If a ghost collides with you, you take a hit, and the meter drains for as long as you're inside the ghost's contact radius.

That probably needs more than direct collision. The ghost could have a standard collision box, but once you hit it, its area of effect grows a little, so you really have to hustle to get away. Once you've left that area, it shrinks back to its normal size.

While you're colliding with a ghost, your psychic stamina drains, and once it's empty you pass out and respawn at the nearest waystone.

I think we could tie this into the lantern. Instead of the lantern running out and simply respawning you, when you're fully in the dark your psychic stamina starts draining, maybe quite fast. I'm not sure about the balance, so for now we could use one standard drain rate, whether you're colliding with a ghost or sitting in the dark. When it's empty, you pass out.

The meter would regenerate simply, as long as nothing is affecting you and you're in your lantern light, or maybe in any lit area, including the area of effect of the sconces.

## Entropy tiles (13:27)

Speaking of lantern mechanics, I'd like some kind of block or tile that fills your entropy meter when you stand on it or in its area of effect. That area would be depletable: it can release only a certain amount of entropy at a time, and if you take it all, it's depleted. Then it slowly refills on its own.

The refill could work in one of two ways. Either it goes through a full cooldown and then comes back online at full strength, or it trickle-charges: after you deplete it there's a short cooldown, then it slowly fills back up, and you can always come back for another little dip. I'm not sure which is better. Maybe both could exist, as two different types of entropy regenerators.

Another thought: maybe this entropy is temporary. It has a potency, so you can fill up on this ethereal entropy but it starts draining right away, which means you can't carry it across the map as a full energy backup.

## Pixies in jars (15:54)

Going back to the jars: since we've decided to make ghosts a permanent entity for now, I still like the concept of capturing something in a jar that has an effect. So let's turn that into a different entity. For now, keep it really simple: a tiny purple circle (or sphere), maybe with little wings. Basically a pixie or fairy that you can catch in a jar. And make the jar simple, with just one pixie in it instead of the three phases for now.

I think the capture mechanic should change. Instead of putting jars on the ground to lure things in (I do like the [likely "luring"] mechanic), you catch the pixies by using a jar when you're close to them [this part is garbled in the recording]. Once a pixie is bottled, you can put it down on the ground, much like we have now, and the ghosts are attracted to the bottled pixie and hang around it, like moths to a flame. They're not glued to it: they wander away, then wander back toward the jar.

That could be a way to manage ghosts. You can't get rid of them, but you can manage their placement, luring them into certain parts of the room so they're easier to get around or avoid. Something about this feels good.

## Emergent behavior and jar trade-offs (19:29)

To generalize this to a very high level, something I've always been interested in is emergent behavior: you have a bunch of entities with properties that do things, and as soon as you put them in a space with other entities, they start interacting in somewhat unexpected ways.

We'll need a deep dive on how to craft and facilitate that, because I don't really understand how it works. But instead of hard-coding "glass jars filled with pixies make a ghost come near," we could generalize it: ghosts are attracted to pixies. If a pixie is out in the wild, ghosts might follow it. When you capture a pixie, the ghost still tries to follow it, but now it's stuck in a jar the ghost can't interact with, so the ghost just wanders around it.

It would be cool to establish all kinds of interesting behaviors like that, almost like an ecosystem. But that will probably have to happen slowly, since we only have one entity implemented so far and the pixie is potentially a second.

Also, I like that jars now involve a trade-off, or at least I think they might. We have hex tiles with a spell symbol that can be powered up by placing a jar on them, giving you an extra entropy container. Now you may need a jar to manage a ghost that is nowhere near one of those hex symbols, so you have to choose: place it there for the buff, or somewhere else to manage the ghost? Trade-offs and choices like this are juicy, and I want to encourage decisions like this throughout. I think it's already starting to happen.

## Waystone look and cost (22:58)

Now I want to talk about the waypoint fast-travel system. I like the waypoints a lot. The game is starting to feel juicy; there's some meat on this procedural dungeon game.

The simplest change: I want the activated state of the waystone to be much more apparent. We should add a simple light source when a waystone is activated, like we do with the sconces, in a purple or blue color. I'd also like the sigils on the waystones to look luminous, always bright and ignoring light and shadow, so we'd be faking an emissive material. And maybe we can borrow the shaft of power from the hex symbol and bring a more subtle, translucent version of it to activated waystones.

A side thought I haven't worked through: should waystones be powered, costing one or two entropy to activate? A one-time activation that gives permanent fast travel is maybe overpowered. Let's keep that as an open question.

## Fast travel as a network (25:40)

On waystones and fast travel in general: as soon as I opened the map with a bunch of waystones placed, I wanted to see them connected as a network. I was thinking of ley lines, a common magical trope of lines of power connecting places, which you can do all sorts of things with.

I also thought how easy and effortless it is to transport anywhere. Once these dungeons get really big (I haven't reached that in my playtests yet, but the idea is a persistent, expansive place), I think we could make fast travel much more compelling by adding a strategic layer. Maybe there should be a cost, such as spending entropy based on distance or on connections, so that going from one side of the map to the other, 20 waystones away, costs you something.

There are many ways to balance that. Fast travel should be convenient, but you don't want it to skip over everything. Right now it feels like you can place yourself anywhere on the map for free.

I don't know exactly how they should connect, but there could be lines drawn between waystones, and maybe some destinations are free to travel to depending on the connection. You couldn't click any arbitrary waystone on the network and just arrive; you'd have to ride through it like a subway line. It might be similar to what we started trying with limiting room rerolls to the most recent room you were in.

As you power up your own abilities or find certain items, you could teleport farther for the same cost, or teleport more cheaply.

The core idea is this: when I opened the map, or interacted with a waystone and it said "pick a waystone to travel," my immediate impression was that I wanted to see how the waystones connect. I want those connections to be meaningful and to affect your ability to travel. And I want it to cost something.

## Recording note (31:06)

[Closing note from the speaker:] I may have just lost a section of this transcript, because I thought I had started recording again and I actually hadn't. I'm not sure.
