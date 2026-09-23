# A chessboard in a wheat field

Build, entirely from code, a realistic farm landscape with a life-size chessboard in it, and two things made from
that one world: a short film and a page where people play chess puzzles on the board.

This is the public example task. Its reference solution is https://github.com/rohithreddy1095/harvest-gambit.
Scored runs use private tasks of the same shape.

## The world

- A working farm in late summer, with rolling land, fields of ripe wheat, a farm road, fences and farm buildings.
  It should look like a real place, not a game level.
- An 8×8 chessboard laid into the field at full scale, with each square several metres across. Its squares belong to
  the farm: for example ploughed soil and mown stubble.
- A full set of carved chess pieces, a few metres tall, standing on it. Standard Staunton shapes, so a chess player
  can read them at a glance. One side is light (the "Livestock"), the other dark (the "Crops").
- Light that moves: the film covers the sun travelling through part of a day.

## The film (50 to 80 seconds)

1. Open on the landscape from the air.
2. Come down to the ground and travel through the farm to the board.
3. Move among the pieces at eye level, so their size and material are felt.
4. Finish on the position of your first puzzle, framed so a chess player can read it, with the words
   "Livestock to move. Mate in 3." and "Reply with the first move." on screen.

How the starting armies turn into the puzzle position is up to you. Add title text of your own choosing.

## The soundtrack

The film's soundtrack is synthesised by your code: music and the sound of the place. It must be the length of the
film.

## The puzzles

Three easy mate-in-3 puzzles (around 1000 to 1400 Lichess rating), Livestock (white) to move, at most 16 pieces each.
On the play page a person picks a Livestock piece, sees where it can go, and moves it. The Crops answer. Wrong moves
are shown and taken back. Solving one ends in a clear checkmate moment.
