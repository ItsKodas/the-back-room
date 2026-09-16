/**
 * What is happening on the floor: the wins, as they land.
 *
 * Only the place for it so far. Nothing in the building announces a win
 * outside its own table yet, and a feed made up on the client to fill the
 * space would be the page inventing facts, so until the tables say so this
 * says plainly what will be here.
 */
export function Activity() {
  return (
    <section className="floor-activity">
      <header className="standings__head">
        <span className="standings__title">On the floor</span>
      </header>
      <p className="standings__note">Wins from the tables will show up here as they happen.</p>
    </section>
  );
}
