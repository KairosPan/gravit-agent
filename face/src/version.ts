/** The dsh family version this face is built against. Upgrade = bump here +
 * package.json together, then run the README upgrade drill ("Upgrading dsh"). */
export const DSH_PIN = "0.2.1-rc.5";

/** cordis is versioned on its own 4.x track, not with the dsh family. At
 * 0.2.1-rc.5 every dsh package peer-depends on it with a TILDE range (`~4.0.5`,
 * `workspace:~` upstream) and the CLI declares the same, so a 4.1 would not
 * satisfy them. Bump this + package.json together, and re-run the drill. */
export const CORDIS_PIN = "4.0.5";

/** The one cordis plugin the face imports directly (`entryListSchema`,
 * src/bots.ts). dsh-app-boot peers it at `~1.0.10`; the other cordis-plugin-*
 * packages (loader, group, timer) arrive transitively and are held by the
 * lockfile alone. */
export const CORDIS_INCLUDE_PIN = "1.0.10";
