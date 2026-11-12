package org.intentpcgrl.record;

import engine.core.MarioAgent;
import engine.core.MarioForwardModel;
import engine.core.MarioTimer;
import engine.core.MarioWorld;
import engine.helper.GameStatus;
import engine.helper.MarioActions;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.GraphicsConfiguration;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Headless gameplay recorder: plays a level with the A* agent and writes the
 * rendered viewport (256x240) as PNG frames, every `every` ticks.
 *
 * Usage: java -Djava.awt.headless=true Recorder LEVEL.txt OUT_DIR [every] [timerSeconds]
 * every <= 0 plays without writing frames (used as the A* acceptance gate).
 * Must run with cwd containing img/ (the Mario sprite sheets).
 */
public class Recorder {
    public static void main(String[] args) throws Exception {
        String level = Files.readString(Path.of(args[0]));
        File out = new File(args[1]);
        out.mkdirs();
        int every = args.length > 2 ? Integer.parseInt(args[2]) : 2;
        int timer = args.length > 3 ? Integer.parseInt(args[3]) : 60;

        BufferedImage frame = new BufferedImage(256, 240, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = frame.createGraphics();
        GraphicsConfiguration gc = g.getDeviceConfiguration();

        engine.helper.Assets.init(gc);
        MarioWorld world = new MarioWorld(null);
        world.visuals = true;
        world.initializeLevel(level, 1000 * timer);
        world.initializeVisuals(gc);
        world.mario.isLarge = false;
        world.mario.isFire = false;
        world.update(new boolean[MarioActions.numberOfActions()]);

        MarioAgent agent = new agents.robinBaumgarten.Agent();
        agent.initialize(new MarioForwardModel(world.clone()), new MarioTimer(40));

        int n = 0;
        int tick = 0;
        while (world.gameStatus == GameStatus.RUNNING) {
            boolean[] actions = agent.getActions(new MarioForwardModel(world.clone()), new MarioTimer(40));
            world.update(actions);
            if (every > 0 && tick++ % every == 0) {
                g.setColor(Color.BLACK);
                g.fillRect(0, 0, 256, 240);
                world.render(g);
                ImageIO.write(frame, "png", new File(out, String.format("f%05d.png", n++)));
            }
        }
        // hold the last frame a little
        for (int i = 0; every > 0 && i < 12; i++) {
            g.fillRect(0, 0, 256, 240);
            world.render(g);
            ImageIO.write(frame, "png", new File(out, String.format("f%05d.png", n++)));
        }
        float completion = world.mario.x / (world.level.exitTileX * 16);
        System.out.println("{\"status\":\"" + world.gameStatus.name() + "\",\"frames\":" + n
                + ",\"ticks\":" + tick + ",\"completion\":" + completion + "}");
    }
}
