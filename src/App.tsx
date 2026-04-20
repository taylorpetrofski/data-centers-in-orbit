/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Scale,
  Leaf,
  TrendingUp,
  ArrowRight,
  FileText,
  Menu,
  X,
  ExternalLink,
} from 'lucide-react';

// --- Types ---
type Page = 'home' | 'regulatory-frameworks' | 'economic-feasibility' | 'environment' | 'resources';

interface Episode {
  id: string;
  title: string;
  guestInfo: string;
  synopsis: string;
  pullQuote?: string;
  pullQuoteAttribution?: string;
  whatWeLearned: string;
  notesUrl: string;
  highlights: { time: string; text: string }[];
  videoUrl: string;
  transcriptUrl: string;
}

function toEmbedUrl(url: string): string {
  if (!url || url === '#') return '';
  const ytShort = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (ytShort) return `https://www.youtube.com/embed/${ytShort[1]}`;
  const ytWatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (ytWatch) return `https://www.youtube.com/embed/${ytWatch[1]}`;
  if (/youtube\.com\/embed\//.test(url)) return url;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  if (/player\.vimeo\.com\/video\//.test(url)) return url;
  return url;
}

const StatusBar = () => (
  <div className="bg-deep-teal text-cream py-1 px-6 flex justify-between items-center text-[8px] font-mono uppercase tracking-[0.4em] border-b border-cream/10">
    <span>CS 4501 // AI AND HUMANITY</span>
    <span>DATA CENTERS IN ORBIT // SPRING 2026</span>
  </div>
);

const Navbar = ({ currentPage, setPage }: { currentPage: Page; setPage: (p: Page) => void }) => {
  const [isOpen, setIsOpen] = useState(false);

  const navLinks: { label: string; value: Page }[] = [
    { label: 'Home', value: 'home' },
    { label: 'Regulatory Frameworks', value: 'regulatory-frameworks' },
    { label: 'Economic Feasibility', value: 'economic-feasibility' },
    { label: 'Environment', value: 'environment' },
    { label: 'Resources', value: 'resources' },
  ];

  return (
    <nav className="fixed top-0 left-0 w-full z-50 border-b-4 border-deep-teal">
      <StatusBar />
      <div className="bg-cream/95 backdrop-blur-sm px-6 h-20 flex items-center justify-between">
        <button onClick={() => setPage('home')} className="flex items-center gap-3 group">
          <span className="font-display font-black text-xl tracking-tighter uppercase text-deep-teal">
            Data Centers <span className="text-atomic-orange italic">In Orbit</span>
          </span>
        </button>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <button
              key={link.value}
              onClick={() => setPage(link.value)}
              className={`text-[10px] font-mono font-bold tracking-[0.2em] uppercase transition-all hover:text-atomic-orange relative py-2 ${
                currentPage === link.value ? 'text-atomic-orange' : 'text-deep-teal'
              }`}
            >
              {link.label}
              {currentPage === link.value && (
                <motion.div
                  layoutId="nav-underline"
                  className="absolute bottom-0 left-0 w-full h-1 bg-atomic-orange"
                />
              )}
            </button>
          ))}
        </div>

        <button className="md:hidden text-deep-teal" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X /> : <Menu />}
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="md:hidden absolute top-full left-0 w-full bg-cream border-b-4 border-deep-teal p-8 flex flex-col gap-6 shadow-2xl"
          >
            {navLinks.map((link) => (
              <button
                key={link.value}
                onClick={() => {
                  setPage(link.value);
                  setIsOpen(false);
                }}
                className={`text-left text-lg font-display font-bold uppercase ${
                  currentPage === link.value ? 'text-atomic-orange' : 'text-deep-teal'
                }`}
              >
                {link.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

// Load the YouTube IFrame API script once, globally.
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeAPI(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return;
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  });
  return ytApiPromise;
}

// Extract a YouTube video ID from any common URL format. Returns null if the URL
// is not a recognized YouTube link (e.g. Vimeo) — in that case we fall back to a
// plain iframe embed, since the YT API only works for YouTube.
function extractYouTubeId(url: string): string | null {
  if (!url || url === '#') return null;
  const ytShort = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (ytShort) return ytShort[1];
  const ytWatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (ytWatch) return ytWatch[1];
  const ytEmbed = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
  if (ytEmbed) return ytEmbed[1];
  return null;
}

const VideoEmbed: React.FC<{ url: string; episodeId: string; startSeconds?: number }> = ({ url, episodeId, startSeconds }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<any>(null);
  const videoId = extractYouTubeId(url);
  const embedUrl = toEmbedUrl(url);

  // Initialize the YouTube player once.
  React.useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let destroyed = false;

    loadYouTubeAPI().then(() => {
      if (destroyed || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
        },
        events: {},
      });
    });

    return () => {
      destroyed = true;
      if (playerRef.current && playerRef.current.destroy) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, [videoId]);

  // When startSeconds changes, seek and play the existing player (no reload = no autoplay block).
  React.useEffect(() => {
    if (startSeconds === undefined || startSeconds < 0) return;
    const player = playerRef.current;
    if (!player) return;

    const seekAndPlay = () => {
      try {
        player.seekTo(startSeconds, true);
        player.playVideo();
      } catch {}
    };

    // The player may not be fully ready yet when the first click happens — poll briefly.
    if (typeof player.seekTo === 'function') {
      seekAndPlay();
    } else {
      const interval = setInterval(() => {
        if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
          seekAndPlay();
          clearInterval(interval);
        }
      }, 100);
      setTimeout(() => clearInterval(interval), 5000);
    }
  }, [startSeconds]);

  // No video URL yet → show the "Video Coming Soon" placeholder.
  if (!embedUrl) {
    return (
      <div className="aspect-video bg-deep-teal border-4 border-deep-teal relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(232,93,4,0.35)]">
        <div className="absolute inset-0 scanline z-10" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-deep-teal/60 z-20">
          <div className="w-16 h-16 rounded-full bg-atomic-orange flex items-center justify-center shadow-[0_0_20px_rgba(232,93,4,0.5)]">
            <div className="w-0 h-0 border-l-[14px] border-l-cream border-y-[10px] border-y-transparent ml-1" />
          </div>
          <span className="text-[10px] font-mono text-cream/70 uppercase tracking-[0.3em]">
            Video Coming Soon
          </span>
        </div>
        <div className="absolute top-4 left-4 text-[10px] font-mono text-cream/40 uppercase tracking-widest z-20">
          SIGNAL_STRENGTH: OPTIMAL // LEO_LINK: ACTIVE
        </div>
        <div className="absolute bottom-4 right-4 text-[10px] font-mono text-cream/60 uppercase tracking-widest z-20">
          [ EPISODE_{episodeId} ]
        </div>
      </div>
    );
  }

  // Non-YouTube (e.g. Vimeo) → plain iframe. Seek-to-timestamp won't work on Vimeo with this method,
  // but the video still embeds and plays normally.
  if (!videoId) {
    return (
      <div className="aspect-video border-4 border-deep-teal relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(232,93,4,0.35)] bg-deep-teal">
        <iframe
          src={embedUrl}
          title={`Mini-Episode ${episodeId}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      </div>
    );
  }

  // YouTube → container div that the YT API will upgrade into a managed iframe.
  return (
    <div className="aspect-video border-4 border-deep-teal relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(232,93,4,0.35)] bg-deep-teal">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};

const EpisodeSection: React.FC<{ episode: Episode }> = ({ episode }) => {
  const [startSeconds, setStartSeconds] = useState<number | undefined>(undefined);
  const videoRef = React.useRef<HTMLDivElement>(null);

  const timeToSeconds = (time: string): number => {
    const parts = time.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  };

  const handleTimestampClick = (time: string) => {
    setStartSeconds(timeToSeconds(time));
    videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="mb-24 last:mb-0">
      <div className="mb-10">
        <div className="inline-block bg-mustard text-deep-teal px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest mb-4">
          Episode {episode.id}
        </div>
        <h3 className="text-4xl md:text-5xl font-display font-black text-deep-teal uppercase italic mb-3 leading-tight">
          {episode.title}
        </h3>
        <p className="text-sm font-bold text-atomic-orange italic mb-8 border-l-4 border-atomic-orange pl-4">
          {episode.guestInfo}
        </p>

        <div className="bg-white/60 p-8 retro-border max-w-4xl">
          <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-4 flex items-center gap-2">
            <div className="w-2 h-2 bg-atomic-orange" /> About This Episode
          </h4>
          <p className="text-base leading-relaxed text-deep-teal font-medium mb-5">
            {episode.synopsis}
          </p>
          {episode.pullQuote && (
            <blockquote className="border-l-4 border-atomic-orange pl-5 mt-5 italic text-lg text-deep-teal font-bold leading-snug">
              “{episode.pullQuote}”
              {episode.pullQuoteAttribution && (
                <div className="text-xs font-mono uppercase tracking-[0.2em] text-deep-teal/60 not-italic mt-3">
                  — {episode.pullQuoteAttribution}
                </div>
              )}
            </blockquote>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-12">
        <div className="lg:w-1/2" ref={videoRef}>
          <VideoEmbed url={episode.videoUrl} episodeId={episode.id} startSeconds={startSeconds} />
          <div className="mt-6 flex items-center gap-6 flex-wrap">
            <a
              href={episode.transcriptUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs font-bold text-atomic-orange hover:text-deep-teal transition-colors uppercase tracking-tighter border-b-2 border-atomic-orange"
            >
              <FileText className="w-4 h-4" />
              Read Full Transcript (PDF)
            </a>
          </div>
        </div>

        <div className="lg:w-1/2 flex flex-col">
          <div className="space-y-8">
            <div className="bg-white/50 p-6 retro-border">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-mustard" /> What We Learned
              </h4>
              <p className="text-sm leading-relaxed text-deep-teal font-medium mb-4">
                {episode.whatWeLearned}
              </p>
              <a
                href={episode.notesUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-xs font-bold text-atomic-orange hover:text-deep-teal transition-colors uppercase tracking-tighter border-b-2 border-atomic-orange"
              >
                <FileText className="w-4 h-4" />
                One-Page Notes (PDF)
              </a>
            </div>

            <div>
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-4 flex items-center gap-2">
                <div className="w-2 h-2 bg-atomic-orange" /> Timestamps
              </h4>
              <ul className="space-y-3">
                {episode.highlights.map((h, i) => (
                  <li key={i} className="text-xs text-deep-teal flex items-start gap-4 group">
                    <button
                      type="button"
                      onClick={() => handleTimestampClick(h.time)}
                      className="font-mono text-atomic-orange font-bold shrink-0 bg-atomic-orange/10 hover:bg-atomic-orange hover:text-cream px-1.5 py-0.5 transition-colors cursor-pointer"
                      aria-label={`Play from ${h.time}`}
                    >
                      {h.time}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTimestampClick(h.time)}
                      className="font-bold leading-relaxed text-left border-b border-transparent group-hover:border-deep-teal/20 hover:text-atomic-orange transition-all cursor-pointer bg-transparent border-0 p-0"
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Footer = ({ setPage }: { setPage: (p: Page) => void }) => (
  <footer className="border-t-4 border-deep-teal py-16 mt-20 bg-deep-teal text-cream relative overflow-hidden star-field">
    <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-start gap-12 relative z-10">
      <div className="flex flex-col items-center md:items-start gap-4">
        <span className="font-display font-black text-3xl tracking-tighter uppercase italic">
          Data Centers <span className="text-atomic-orange">In Orbit</span>
        </span>
        <div className="text-xs font-mono uppercase tracking-[0.2em] opacity-70 max-w-xs text-center md:text-left leading-relaxed space-y-1">
          <div>CS 4501: AI and Humanity</div>
          <div>Dr. David Evans</div>
          <div>University of Virginia</div>
          <div>Spring 2026</div>
        </div>
      </div>

      <div className="flex flex-col items-center md:items-end gap-6">
        <div className="flex flex-wrap gap-x-8 gap-y-3 justify-center md:justify-end">
          {[
            { label: 'Home', value: 'home' as Page },
            { label: 'Regulatory Frameworks', value: 'regulatory-frameworks' as Page },
            { label: 'Economic Feasibility', value: 'economic-feasibility' as Page },
            { label: 'Environment', value: 'environment' as Page },
            { label: 'Resources', value: 'resources' as Page },
          ].map((link) => (
            <button
              key={link.value}
              onClick={() => setPage(link.value)}
              className="text-xs font-bold uppercase tracking-widest hover:text-atomic-orange transition-colors border-b-2 border-transparent hover:border-atomic-orange pb-1"
            >
              {link.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-[10px] font-mono uppercase tracking-widest opacity-40">
            © 2026 · CS 4501: AI & Humanity
          </div>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="w-10 h-10 bg-atomic-orange text-cream flex items-center justify-center hover:bg-mustard hover:text-deep-teal transition-all"
          >
            <ArrowRight className="w-5 h-5 -rotate-90" />
          </button>
        </div>
      </div>
    </div>

    <div className="absolute bottom-0 left-0 w-full h-1 bg-atomic-orange" />
  </footer>
);

const HomePage = ({ setPage }: { setPage: (p: Page) => void }) => (
  <div className="grainy-texture">
    <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 pt-40 pb-16 relative overflow-hidden star-field">
      <div className="absolute top-24 left-0 w-full overflow-hidden border-y-2 border-deep-teal/20 py-2 bg-white/30 backdrop-blur-sm">
        <div className="flex animate-marquee whitespace-nowrap">
          <span className="marquee-text mx-8">
            SPACEX FILING: UP TO 1,000,000 DATA-CENTER SATELLITES  //  GOOGLE PROJECT SUNCATCHER  //  CHINA'S FIVE-YEAR PLAN INCLUDES ORBITAL COMPUTE  //  STARCLOUD VALUED AT $1.1B  //  $2,000 PER KG TO ORBIT TODAY  //  $200 PER KG NEEDED BY MID-2030S  //
          </span>
          <span className="marquee-text mx-8">
            SPACEX FILING: UP TO 1,000,000 DATA-CENTER SATELLITES  //  GOOGLE PROJECT SUNCATCHER  //  CHINA'S FIVE-YEAR PLAN INCLUDES ORBITAL COMPUTE  //  STARCLOUD VALUED AT $1.1B  //  $2,000 PER KG TO ORBIT TODAY  //  $200 PER KG NEEDED BY MID-2030S  //
          </span>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="max-w-4xl z-10"
      >
        <h1 className="text-7xl md:text-[10rem] font-display font-black text-deep-teal leading-[0.8] mb-8 uppercase italic tracking-tighter">
          Data Centers <br />
          <span className="text-atomic-orange">In Orbit</span>
        </h1>

        <div className="flex items-center justify-center mb-12">
          <p className="text-lg md:text-2xl text-deep-teal font-bold uppercase tracking-tight whitespace-nowrap">
            As AI strains Earth’s infrastructure, should we look up?
          </p>
        </div>

        <motion.button
          onClick={() => setPage('regulatory-frameworks')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-atomic-orange text-cream px-10 py-4 font-display font-black uppercase italic text-xl retro-border hover:bg-deep-teal transition-colors mb-16"
        >
          Explore the Orbit
        </motion.button>

        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="flex flex-col items-center gap-2 text-atomic-orange"
        >
          <span className="text-[10px] font-mono uppercase tracking-[0.3em]">Scroll to Explore</span>
          <ArrowRight className="w-6 h-6 rotate-90" />
        </motion.div>
      </motion.div>
    </section>

    <section className="max-w-5xl mx-auto px-6 py-40 text-center">
      <div className="bg-white retro-border p-16 relative">
        <div className="absolute -top-4 -left-4 bg-atomic-orange text-white px-6 py-2 text-xs font-mono uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(13,71,78,1)]">
          Project Brief // 001
        </div>
        <div className="absolute -bottom-4 -right-4 bg-mustard text-deep-teal px-6 py-2 text-xs font-mono uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(13,71,78,1)]">
          Status: Active
        </div>
        <p className="text-2xl md:text-4xl text-deep-teal font-bold leading-tight italic mb-4">
          “To hear Silicon Valley tell it, artificial intelligence is outgrowing the planet that gave birth to it.”
        </p>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/50 mb-8">
          Jeremy Hsu, Scientific American · December 2025
        </p>
        <p className="text-lg text-deep-teal/70 font-medium max-w-2xl mx-auto leading-relaxed">
          Google’s Project Suncatcher, Starcloud’s $1.1B valuation, SpaceX’s filing for up to one
          million data-center satellites, and China’s new five-year plan have all put this idea on
          the table. Our project explores what it would really mean, economically, environmentally,
          and for how we regulate it, if AI infrastructure began to leave Earth.
        </p>
      </div>
    </section>

    {/* Project Introduction Video */}
    <section className="max-w-5xl mx-auto px-6 pb-32">
      <div className="mb-8 text-center">
        <div className="inline-block bg-mustard text-deep-teal px-3 py-1 text-[10px] font-mono uppercase tracking-widest mb-4">
          Project Introduction
        </div>
        <h2 className="text-4xl md:text-5xl font-display font-black text-deep-teal uppercase italic leading-tight">
          Meet the Project
        </h2>
      </div>
      {(() => {
        const introVideoUrl = 'https://youtu.be/8hozhHHQGiA';
        const embedUrl = toEmbedUrl(introVideoUrl);
        if (!embedUrl) {
          return (
            <div className="aspect-video bg-deep-teal border-4 border-deep-teal relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(232,93,4,0.35)]">
              <div className="absolute inset-0 scanline z-10" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-deep-teal/60 z-20">
                <div className="w-16 h-16 rounded-full bg-atomic-orange flex items-center justify-center shadow-[0_0_20px_rgba(232,93,4,0.5)]">
                  <div className="w-0 h-0 border-l-[14px] border-l-cream border-y-[10px] border-y-transparent ml-1" />
                </div>
                <span className="text-[10px] font-mono text-cream/70 uppercase tracking-[0.3em]">
                  Intro Video Coming Soon
                </span>
              </div>
            </div>
          );
        }
        return (
          <div className="aspect-video border-4 border-deep-teal relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(232,93,4,0.35)] bg-deep-teal">
            <iframe
              src={embedUrl}
              title="Project Introduction"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        );
      })()}
    </section>

    <section className="max-w-7xl mx-auto px-6 pb-40">
      <div className="grid md:grid-cols-3 gap-12">
        <div className="retro-card flex flex-col h-full group">
          <div className="w-20 h-20 bg-mustard/20 border-4 border-deep-teal flex items-center justify-center mb-8 group-hover:bg-mustard/40 transition-all">
            <Scale className="w-10 h-10 text-deep-teal" />
          </div>
          <h3 className="text-3xl font-display font-black text-deep-teal mb-4 uppercase italic">
            Regulatory Frameworks
          </h3>
          <p className="text-base text-deep-teal/70 mb-10 flex-grow font-medium leading-relaxed">
            The case for space as a simpler regulatory environment, the limits of international governance over orbital infrastructure, and the growing private-sector control of critical AI compute.
          </p>
          <button
            onClick={() => setPage('regulatory-frameworks')}
            className="w-full py-4 bg-deep-teal text-cream font-bold uppercase tracking-widest hover:bg-atomic-orange transition-colors flex items-center justify-center gap-3 text-sm"
          >
            Access Dossier <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="retro-card flex flex-col h-full group">
          <div className="w-20 h-20 bg-mustard/20 border-4 border-deep-teal flex items-center justify-center mb-8 group-hover:bg-mustard/40 transition-all">
            <TrendingUp className="w-10 h-10 text-deep-teal" />
          </div>
          <h3 className="text-3xl font-display font-black text-deep-teal mb-4 uppercase italic">
            Economic Feasibility
          </h3>
          <p className="text-base text-deep-teal/70 mb-10 flex-grow font-medium leading-relaxed">
            Are orbital data centers a real economic bet or a symptom of a tech industry in arms-race mode, with a potential dot-com-style overbuild on the horizon?
          </p>
          <button
            onClick={() => setPage('economic-feasibility')}
            className="w-full py-4 bg-deep-teal text-cream font-bold uppercase tracking-widest hover:bg-atomic-orange transition-colors flex items-center justify-center gap-3 text-sm"
          >
            Access Dossier <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="retro-card flex flex-col h-full group">
          <div className="w-20 h-20 bg-mustard/20 border-4 border-deep-teal flex items-center justify-center mb-8 group-hover:bg-mustard/40 transition-all">
            <Leaf className="w-10 h-10 text-deep-teal" />
          </div>
          <h3 className="text-3xl font-display font-black text-deep-teal mb-4 uppercase italic">
            Environment
          </h3>
          <p className="text-base text-deep-teal/70 mb-10 flex-grow font-medium leading-relaxed">
            Whether moving data centers to space actually reduces environmental harm or simply shifts it somewhere harder to see and harder to govern.
          </p>
          <button
            onClick={() => setPage('environment')}
            className="w-full py-4 bg-deep-teal text-cream font-bold uppercase tracking-widest hover:bg-atomic-orange transition-colors flex items-center justify-center gap-3 text-sm"
          >
            Access Dossier <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>

    <section className="bg-deep-teal text-cream py-32 star-field">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
          <div className="max-w-2xl">
            <h2 className="text-5xl md:text-7xl font-display font-black uppercase italic mb-6">
              The <span className="text-atomic-orange">Team</span>
            </h2>
            <p className="text-xl font-bold italic opacity-80">
              A student research project for CS 4501: AI and Humanity at the University of Virginia.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] opacity-40 mb-2">Course</div>
            <div className="text-2xl font-mono font-bold text-mustard">CS 4501 · Spring 2026</div>
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] opacity-40 mt-3">
              Instructor: Dr. David Evans
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          {[
            { name: 'Aaryan Asthana' },
            { name: 'Kate McCray' },
            { name: 'Taylor Petrofski' },
            { name: 'Alyssa Rodrigues' },
            { name: 'Yusuf Sharif' },
            { name: 'Shaurya Singh' },
          ].map((member, i) => (
            <div key={i} className="border-l-2 border-atomic-orange pl-6 py-4">
              <div className="text-lg font-display font-bold uppercase">{member.name}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  </div>
);

function EpisodePage({
  title,
  problem,
  episodes,
  icon: Icon,
}: {
  title: string;
  problem: string;
  episodes: Episode[];
  icon: any;
}) {
  return (
    <div className="pt-40 max-w-7xl mx-auto px-6 grainy-texture">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-24 border-b-8 border-deep-teal pb-12 relative"
      >
        <div className="absolute -top-10 left-0 text-[10px] font-mono text-deep-teal/40 uppercase tracking-[0.4em]">
          CLASSIFICATION: DECLASSIFIED // TOPIC_ID: {title.toUpperCase().replace(/ /g, '_')}
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-8 mb-10">
          <div className="w-24 h-24 bg-mustard/20 border-4 border-deep-teal flex items-center justify-center shadow-[6px_6px_0px_0px_rgba(13,71,78,1)]">
            <Icon className="w-12 h-12 text-deep-teal" />
          </div>
          <h1 className="text-5xl md:text-8xl font-display font-black text-deep-teal uppercase italic tracking-tighter leading-none">
            {title}
          </h1>
        </div>
        <div className="bg-atomic-orange text-cream p-8 retro-border max-w-5xl">
          <p className="text-xl md:text-3xl font-bold italic leading-tight">{problem}</p>
        </div>
      </motion.div>

      <div className="space-y-32 pb-32">
        {episodes.map((ep) => (
          <EpisodeSection key={ep.id} episode={ep} />
        ))}
      </div>
    </div>
  );
}

const NextPage = () => (
  <div className="pt-40 max-w-7xl mx-auto px-6 grainy-texture pb-32">
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-20 border-b-8 border-deep-teal pb-12 relative">
        <div className="absolute -top-10 left-0 text-[10px] font-mono text-deep-teal/40 uppercase tracking-[0.4em]">
          PROJECT RESOURCES // SOURCES + REFLECTIONS
        </div>
        <h1 className="text-7xl md:text-[10rem] font-display font-black text-deep-teal uppercase italic tracking-tighter leading-none">
          What’s <span className="text-atomic-orange">Next?</span>
        </h1>
        <p className="mt-10 max-w-4xl mx-auto text-center text-xl md:text-2xl text-deep-teal font-bold italic leading-tight">
          We came at this question from three different angles across our episodes. We learned more than we expected, and we changed our minds on a few things along the way. Below is what stuck, the sources that shaped the series, and what we think is worth watching from here.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-20 items-start">
        <div className="bg-white p-10 retro-border">
          <h2 className="text-4xl font-display font-black text-deep-teal mb-10 uppercase italic flex items-center gap-4">
            <div className="w-10 h-10 bg-atomic-orange flex items-center justify-center">
              <Scale className="w-6 h-6 text-cream" />
            </div>
            What We Learned
          </h2>
          <div className="space-y-8">
            {[
              'The physics is what actually drives the push to orbit. Space offers abundant solar energy and natural cold, and our guests kept coming back to that. The regulatory argument is real but secondary. Companies are not fleeing Earth to escape imminent rules.',
              'The economics is a bet on scale, not a calculation. Hyperscalers are chasing nuclear power, behind-the-meter gas, sea-based cooling, and orbital deployment all at once. They are betting that being slow is worse than being expensive, and the real question is whether returns to data keep scaling.',
              'AGI is on a much shorter timeline than regulation. Our guests put a working definition of AGI within the next one to two years. Any international framework would take far longer to build. The governance conversation is arriving after the technical one has largely been settled by default.',
              'Private power is the new governance question. SpaceX holds US launch. Starlink is doing battlefield communications in Ukraine. Anthropic pushed back on the Pentagon. Critical national security infrastructure now sits inside a handful of private companies, and the government is still working out what that means.',
              'Orbit is not an empty frontier. It is a shared finite environment with real lifecycle costs. Launch emissions, manufacturing inputs, collision risk, and reentry chemistry all sit outside the existing regulatory picture. The FCC handles licensing and the FAA handles launch, and no one holds the whole model.',
              'The environmental case is cautiously optimistic, not clean. Orbital compute could genuinely ease terrestrial burdens on water, grid, and land for communities already bearing the brunt. The harder question is whether the burden actually shrinks or just moves somewhere harder to see and harder to govern.',
            ].map((text, i) => (
              <div key={i} className="flex gap-6 items-start group">
                <div className="w-4 h-4 bg-atomic-orange mt-1.5 shrink-0 rotate-45 group-hover:rotate-90 transition-transform" />
                <p className="text-xl font-bold text-deep-teal leading-tight">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-20">
          <div className="bg-mustard/10 p-10 border-4 border-mustard shadow-[8px_8px_0px_0px_rgba(228,167,37,0.25)]">
            <h3 className="text-3xl font-display font-black text-deep-teal mb-8 uppercase italic flex items-center gap-4">
              <TrendingUp className="w-8 h-8 text-mustard" /> What to Look Out For
            </h3>
            <div className="space-y-10">
              {[
                {
                  heading: 'LAUNCH COSTS',
                  body: "Watch Starship. Google's Suncatcher team estimates liftoff costs need to fall to under $200 per kilogram by 2035 for the economics to work. Everything downstream runs on whether SpaceX gets there and whether competitors follow.",
                },
                {
                  heading: 'PRIVATE AND PUBLIC POWER',
                  body: "Watch how governments react when private companies control critical infrastructure. Anthropic's dispute with the Pentagon, SpaceX's launch monopoly, and Starlink's role in Ukraine are early signs of a tension that will only sharpen as orbital compute matures.",
                },
                {
                  heading: 'THE AGI TIMELINE',
                  body: "Watch model capability, not just model size. Our guests think the AGI window is short. If they are right, the question of how to govern space-based AI compute arrives after the question of how to govern AI itself has already been answered by default.",
                },
                {
                  heading: 'ORBITAL CROWDING',
                  body: "Watch the FCC filings. SpaceX's million-satellite filing, Amazon's 52,000, and Starcloud's 88,000 are not hypotheticals. Debris, collision risk, reentry chemistry, and astronomy impacts are all compounding in a domain governed by a 1967 treaty that was never written for this.",
                },
              ].map((item, i) => (
                <div key={i}>
                  <div className="w-12 h-1 bg-mustard mb-4" />
                  <div className="text-xs font-mono font-bold text-mustard uppercase tracking-wide mb-2">
                    {item.heading}
                  </div>
                  <p className="text-deep-teal font-bold leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-deep-teal p-10 text-cream shadow-[8px_8px_0px_0px_rgba(13,71,78,0.3)]">
            <h3 className="text-3xl font-display font-black mb-8 uppercase italic flex items-center gap-4">
              <FileText className="w-8 h-8 text-atomic-orange" /> Sources
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { title: 'Even the Sky May Not Be the Limit for A.I. Data Centers', outlet: 'The New York Times', url: 'https://www.nytimes.com/2026/01/01/technology/space-data-centers-ai.html' },
                { title: 'Big Tech Dreams of Putting Data Centers in Space', outlet: 'WIRED', url: 'https://www.wired.com/story/data-centers-gobble-earths-resources-what-if-we-took-them-to-space-instead/' },
                { title: 'Space-Based Data Centers Could Power AI with Solar Energy \u2014 At a Cost', outlet: 'Scientific American', url: 'https://www.scientificamerican.com/article/data-centers-in-space/' },
                { title: 'Orbital data centers, part 1: There\u2019s no way this is economically viable, right?', outlet: 'Ars Technica', url: 'https://arstechnica.com/space/2026/03/orbital-data-centers-part-1-theres-no-way-this-is-economically-viable-right/' },
                { title: 'Musk wants SpaceX IPO to fund AI space data centers, Microsoft\u2019s undersea setback sounds warning', outlet: 'Reuters', url: 'https://www.reuters.com/business/aerospace-defense/spacexs-orbital-data-centers-could-face-same-hurdles-microsofts-abandoned-2026-04-01/' },
                { title: 'Starcloud raises $170M for space-based data centers, hits $1.1B valuation', outlet: 'GeekWire', url: 'https://www.geekwire.com/2026/orbital-ai-seattle-area-startup-starcloud-hits-1-1b-valuation-to-build-space-based-data-centers/' },
                { title: 'Four things we\u2019d need to put data centers in space', outlet: 'MIT Technology Review', url: 'https://www.technologyreview.com/2026/04/03/1135073/four-things-wed-need-to-put-data-centers-in-space/' },
                { title: 'As AI Grows, Should We Move Data Centers to Space?', outlet: 'TIME', url: 'https://time.com/7344364/ai-data-centers-in-space/' },
                { title: 'Google CEO Sundar Pichai: Data centers in space will be the new normal in next decade', outlet: 'Fortune', url: 'https://fortune.com/article/what-is-google-ceo-sundar-pichai-timeline-ai-data-centers-in-space/' },
                { title: 'Starcloud CEO Philip Johnston on Putting First Data Center in Space', outlet: 'Observer', url: 'https://observer.com/2026/03/starcloud-ceo-philip-johnston-nvidia-space-data-center/' },
                { title: 'China joins race to develop space-based data centers with 5-year plan', outlet: 'Space.com', url: 'https://www.space.com/space-exploration/satellites/china-joins-race-to-develop-space-based-data-centers-with-5-year-plan' },
                { title: 'How data centres in space sustainably enable the AI age', outlet: 'World Economic Forum', url: 'https://www.weforum.org/stories/2026/01/data-centres-space-ai-revolution/' },
                { title: 'Why Jeff Bezos Is Probably Wrong Predicting AI Data Centers in Space', outlet: 'Chaotropy', url: 'https://www.chaotropy.com/why-jeff-bezos-is-probably-wrong-predicting-ai-data-centers-in-space/' },
                { title: 'Data centres in space: they\u2019re a brilliant idea, but a herculean challenge', outlet: 'The Conversation', url: 'https://theconversation.com/data-centres-in-space-theyre-a-brilliant-idea-but-a-herculean-challenge-246635' },
                { title: 'One giant leap for AI', outlet: 'IBM Think', url: 'https://www.ibm.com/think/news/data-centers-in-space-one-giant-leap-ai' },
                { title: 'US data centers\u2019 energy use amid the AI boom', outlet: 'Pew Research Center', url: 'https://www.pewresearch.org/short-reads/2025/10/24/what-we-know-about-energy-use-at-us-data-centers-amid-the-ai-boom/' },
                { title: 'What Happens When Data Centers Come to Town?', outlet: 'University of Michigan STPP', url: 'https://stpp.fordschool.umich.edu/sites/stpp/files/2025-07/stpp-data-centers-2025.pdf' },
                { title: 'Why we should train AI in space', outlet: 'Starcloud (white paper)', url: 'https://starcloudinc.github.io/wp.pdf' },
                { title: 'New Data Science Entrepreneurship Building planned for UVA\u2019s Emmet-Ivy Corridor', outlet: 'UVA Today', url: 'https://news.virginia.edu/content/new-data-science-entrepreneurship-building-planned-uvas-emmet-ivy-corridor' },
              ].map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-5 bg-white/5 border-2 border-cream/20 hover:bg-white/10 hover:border-atomic-orange transition-all group"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold group-hover:text-atomic-orange leading-tight text-cream">
                      {s.title}
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-60 text-cream">
                      {s.outlet}
                    </span>
                  </div>
                  <ExternalLink className="w-5 h-5 text-atomic-orange shrink-0 ml-4" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  </div>
);

export default function App() {
  const [page, setPage] = useState<Page>('home');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const regulatoryEpisodes: Episode[] = [
    {
      id: '1.1',
      title: 'Regulating the Race to Orbit',
      guestInfo: 'Professor Allan Stam — University of Virginia, Frank Batten School of Leadership and Public Policy',
      synopsis:
        'A wide-ranging conversation with Professor Allan Stam on why space may actually be easier to regulate than Earth, a single federal agency rather than a five-layer stack of city, county, state, and federal rules, on how the race toward artificial general intelligence is reshaping every adjacent technology question, and on why Stam believes we will see AGI before we see meaningful regulation of it. The conversation ranges from orbital slots and anti-satellite weapons to Palantir\'s Maven, the Mythos model leak, and the near-term reality of models that write their own successor models.',
      pullQuote:
        'We\'re in a 12- to 24-month period where AGI is right there. We\'re going to see AGI before we see regulation of AGI.',
      pullQuoteAttribution: 'Stam',
      whatWeLearned:
        'Stam keeps coming back to a Magic 8-Ball metaphor, too soon to tell, ask again later. He puts the odds of space-based data centers becoming real infrastructure at 50/50, hinging almost entirely on whether SpaceX\'s Super Heavy rocket works and drives launch costs down three orders of magnitude. On the ground, small fission reactors sized for a single data center may arrive first; in space, the appeal is physics as much as regulation. The bigger story for Stam is how short the runway really is. He expects AGI within 12 to 24 months, well before any international treaty could catch up. And in the near term, what keeps him up at night isn\'t orbital infrastructure. It\'s models that can write their own successors and find zero-day vulnerabilities faster than humans can patch them.',
      notesUrl: 'https://drive.google.com/file/d/1fKRjsHbVpq2-QVQ9CkATR4RiPj_61CIT/view?usp=sharing',
      highlights: [
        { time: '00:00', text: 'Introduction and background' },
        { time: '02:14', text: 'Is compute demand really pushing us toward space?' },
        { time: '05:04', text: 'The regulatory appeal of space' },
        { time: '08:56', text: 'Can the regulatory environment in space stay simpler?' },
        { time: '10:04', text: 'Who has jurisdiction over orbital data centers?' },
        { time: '11:24', text: 'Is there an international framework for any of this?' },
        { time: '15:28', text: 'China, the U.S., and great power competition' },
        { time: '18:55', text: 'Is this the first AI war? Palantir\'s Maven explained' },
        { time: '24:29', text: 'The U.S. government and private companies' },
        { time: '27:07', text: 'Security risks, anti-satellite weapons, and lasers' },
        { time: '30:02', text: 'What concerns Professor Stam most: artificial superintelligence' },
        { time: '34:13', text: 'Final prediction: will space-based data centers actually happen?' },
      ],
      videoUrl: 'https://youtu.be/vrJwapUwdl4',
      transcriptUrl: 'https://drive.google.com/file/d/1Zmd9ckoqMKBbpPnFGFt15kpl7e_5XPbm/view',
    },
    {
      id: '1.2',
      title: 'Rules, Physics, and Private Power',
      guestInfo: 'Professor Philip Potter — Professor of Public Policy, Founding Director of the National Security Policy Center, University of Virginia',
      synopsis:
        'A wide-ranging conversation with Professor Philip Potter on whether orbital data centers will actually relieve terrestrial compute pressure, why the physics (not the regulation) is the real draw, and what happens when critical AI infrastructure is built and controlled almost entirely by private companies like SpaceX and Anthropic. Potter argues that much of what needs to be regulated in orbit is already covered by existing frameworks around orbital slots and debris mitigation, and pushes back on the idea that U.S. companies are racing to escape imminent regulation.',
      pullQuote:
        'Regulation routinely struggles to catch up to emerging technology. Sometimes the bigger problem is if it manages to think it caught up.',
      pullQuoteAttribution: 'Potter',
      whatWeLearned:
        'Potter is a skeptic about the near-term case but bullish on the long one. He doesn\'t buy the idea that Congress is about to regulate space into the ground, or that U.S. companies are in any real rush to escape the regulation that does exist. What he finds genuinely new is the shape of the power dynamic. Anthropic\'s fight with the Pentagon, the Defense Department\'s reliance on SpaceX for launch, and Ukraine rolling down to Starlink for battlefield comms all point to the same thing. The critical national security technologies of this era are being built, owned, and governed by a handful of private companies, and the government is trying to figure out what that means in real time.',
      notesUrl: 'https://drive.google.com/file/d/1CcqSWUdqlB0xzi342-M2S9kbzGYGVf2C/view?usp=sharing',
      highlights: [
        { time: '00:00', text: 'Introduction and background' },
        { time: '00:56', text: 'Is compute demand really pushing us toward space?' },
        { time: '03:07', text: 'Why terrestrial solutions still come first' },
        { time: '05:18', text: 'The regulatory appeal of space' },
        { time: '07:13', text: 'Is escaping regulation a real motivator?' },
        { time: '10:13', text: 'Is there a space race to put compute in orbit?' },
        { time: '11:35', text: 'Who\'s responsible when things go wrong in orbit?' },
        { time: '12:49', text: 'Can regulation keep up with emerging tech?' },
        { time: '13:56', text: 'Do we need an international framework?' },
        { time: '15:07', text: 'China, U.S., and great power competition' },
        { time: '20:04', text: 'Security, jamming, and resilience' },
        { time: '22:12', text: 'UVA\'s $72M Fontaine research data center' },
        { time: '25:10', text: 'The private-public imbalance, Anthropic and SpaceX' },
        { time: '28:58', text: 'What concerns Potter most' },
        { time: '31:36', text: 'Final prediction: will this actually happen?' },
      ],
      videoUrl: 'https://youtu.be/9svr3BeELHw',
      transcriptUrl: 'https://drive.google.com/file/d/11u3OtfREblzmHW_VAPwPWAxPbdVRA_RA/view',
    },
  ];

  const economicEpisodes: Episode[] = [
    {
      id: '2',
      title: 'Arms Race or Bubble',
      guestInfo: 'Professor Michael Lenox — University of Virginia, Darden School of Business',
      synopsis:
        'A conversation with Professor Michael Lenox on whether orbital data centers actually make economic sense, or whether they\'re a symptom of a tech industry in arms-race mode that might be heading for a dot-com-style overbuild. Drawing on his research at the intersection of technology strategy, innovation, and policy, Lenox argues that the real question isn\'t whether space-based compute pencils out today. It\'s whether we hit decreasing returns to data before the capital dries up. The conversation ranges from cooling as the hidden constraint behind Arctic and sea-based data centers, to behind-the-meter natural gas turbines, to why the nuclear analogy for AI completely misses what\'s happening.',
      pullQuote:
        'The biggest question is when we hit decreasing returns to data. If more training keeps getting us a better model, we\'re in a true arms race. Build scale as quickly as possible and freeze out everyone else.',
      pullQuoteAttribution: 'Lenox',
      whatWeLearned:
        'Lenox reframes the economic question away from launch-cost math and toward something harder to model. Everyone\'s betting that scale wins, which is why capital is flowing into data centers faster than the grid can keep up. But if returns to data flatten, the industry looks less like a race and more like the dot-com overbuild, where cheap broadband enabled Netflix but bankrupted the companies that laid the fiber. Space fits into that bet as one of many simultaneous wagers on speed. Hyperscalers are looking at nuclear, behind-the-meter natural gas, sea-based cooling, and orbital deployment all at once, not because any of them are obviously cheap, but because being slow is worse than being expensive. The real bottleneck isn\'t chips or capital. It\'s electricity. Some of the biggest tech companies have warehouses of idle Nvidia silicon waiting for power that isn\'t there yet. And the utilities responsible for getting it there are structurally unable to move at the speed tech is demanding.',
      notesUrl: 'https://drive.google.com/file/d/1HhrfBMmG23dyu0sBSmsCl4Mtcp2xWxSo/view?usp=sharing',
      highlights: [
        { time: '00:00', text: 'Introduction and guest background' },
        { time: '01:43', text: 'Is compute demand really pushing us toward space?' },
        { time: '05:47', text: 'How real is the economic pressure driving this?' },
        { time: '06:17', text: 'The time value of money and the winner-take-all arms race' },
        { time: '07:25', text: 'The dot-com parallel and a potential compute glut' },
        { time: '09:32', text: 'The role of government and the utility-tech pace mismatch' },
        { time: '13:44', text: 'Regulatory gaps and non-market strategy' },
        { time: '15:00', text: 'Why the nuclear analogy for AI breaks down' },
      ],
      videoUrl: 'https://youtu.be/v9wqZiyZIGk',
      transcriptUrl: 'https://drive.google.com/file/d/1KQpxXJRR9WJVodDyy66iIMNExMYJHLAo/view?usp=sharing',
    },
  ];

  const environmentEpisodes: Episode[] = [
    {
      id: '3.1',
      title: 'The Environmental Ledger',
      guestInfo: 'Hosted by Kate McCray and Alyssa Rodrigues',
      synopsis:
        'Kate and Alyssa open the environmental section by laying out the case on both sides. On Earth, data centers already consume 4% of US electricity, a figure projected to grow 133% by 2030, and a single hyperscaler can use as much water as four million homes. In orbit, solar panels reach a 95% capacity factor compared to 24% on the ground, cooling needs no water, and there is no local community displacement. But the orbital ledger includes rocket emissions, reentry pollution, ozone depletion, and a growing debris problem. This episode frames the trade-off that the Ong Whaley conversation takes apart.',
      pullQuote:
        'Moving data centers into space might solve the environmental problems we can readily see and understand now. But it may create new environmental problems in places we don\'t yet have the tools, science, or governance to fully understand.',
      pullQuoteAttribution: 'Kate McCray',
      whatWeLearned:
        'The hosts land on a cautiously optimistic read. Orbital data centers could genuinely help mitigate real harms happening on Earth right now, especially to communities bearing the brunt of terrestrial infrastructure. But the case rests on the assumption that the environmental burden actually shrinks rather than simply moves to a place that is harder to see and harder to govern. Kate and Alyssa are skeptical that the public will have meaningful input, skeptical that regulation will catch up in time, and uneasy about the unseen consequences of scaling launch activity and orbital infrastructure. Their takeaway frames the series question directly. Out of sight does not mean out of consequence.',
      notesUrl: '#',
      highlights: [
        { time: '00:00', text: 'Introduction' },
        { time: '00:10', text: 'The energy and water cost of terrestrial data centers' },
        { time: '01:20', text: 'Land use and community displacement' },
        { time: '01:32', text: 'The case for moving data centers to orbit' },
        { time: '02:51', text: 'Hidden costs, launch emissions and ozone depletion' },
        { time: '03:12', text: 'Space debris and reentry pollution' },
        { time: '03:40', text: 'Our take, cautiously optimistic' },
        { time: '06:18', text: 'Out of sight, not out of consequence' },
      ],
      videoUrl: 'https://youtu.be/hQZoky6SiKI',
      transcriptUrl: '#',
    },
    {
      id: '3.2',
      title: 'Orbit as a Commons',
      guestInfo: 'Dr. Carah Ong Whaley — University of Virginia, Center for Politics',
      synopsis:
        'A conversation with Dr. Carah Ong Whaley on whether moving data centers to orbit would actually reduce their environmental footprint or simply relocate it. Drawing on her background in nuclear weapons policy and her current work on the politics of AI, Ong Whaley argues that orbit is a shared finite environmental commons, not an empty frontier, and that the industry is treating sustainability as an engineering problem to be solved later rather than a governance challenge to be addressed now. The conversation moves through UVA\'s own Fontaine Research Park data center, the 1967 Outer Space Treaty, SpaceX\'s February 2026 filing for a million-satellite system, and what an ordinary person can actually do about any of it.',
      pullQuote:
        'Orbit is not an infinite void. It\'s a limited shared environment. We\'re not just judging space infrastructure by what it produces, but also what it\'s going to leave behind.',
      pullQuoteAttribution: 'Ong Whaley',
      whatWeLearned:
        'Ong Whaley\'s core move is to refuse the framing that orbital data centers are a clean technological leap. Instead she asks the lifecycle question, launch emissions, manufacturing inputs, collision externalities, end-of-life reentry and atmospheric chemistry, and argues that the industry is solving a narrow version of the environmental problem while creating a broader one. The governance picture is worse than a patchwork. It\'s a set of gaps, because the FCC looks at satellite licensing, the FAA at launch and reentry, and no one holds the whole infrastructure model. The Outer Space Treaty was written in 1967 and was never designed for constellation-scale commercial deployment. Layer on first-mover advantage, the companies that launch now are shaping the rules that will eventually try to catch them, and the reactive nature of governance starts to feel like a structural problem, not a timing one. Her final answer on what ordinary people can do is disarmingly simple. Call your lawmaker and ask whether they\'re paying attention.',
      notesUrl: 'https://drive.google.com/file/d/18OFov1Hvn2DTvg0Mq9RCa1IKxafWRkpL/view?usp=sharing',
      highlights: [
        { time: '00:00', text: 'Introduction and background' },
        { time: '02:26', text: 'Thoughts on UVA\'s Fontaine Research Park data center' },
        { time: '04:52', text: 'Does moving data centers to space actually reduce water use?' },
        { time: '06:50', text: 'Are companies genuinely prioritizing sustainability, or is it a pitch?' },
        { time: '12:08', text: 'The 1967 Outer Space Treaty and what it can\'t govern' },
        { time: '17:48', text: 'Gaps, not loopholes, in the fragmented US regulatory picture' },
        { time: '19:59', text: 'Should space be governed country-by-country, by the UN, or by something new?' },
        { time: '24:42', text: 'First-mover advantage and reactive governance' },
        { time: '25:35', text: 'Parallels between terrestrial and orbital data center governance' },
        { time: '31:09', text: 'What should be at the forefront of policymakers\' minds?' },
        { time: '33:17', text: 'How the everyday person should situate themselves in this' },
      ],
      videoUrl: 'https://youtu.be/fntpoCg7_00',
      transcriptUrl: 'https://drive.google.com/file/d/1SJFIyNOI94OSIzrQZikfT8bGL6tFqn9O/view?usp=sharing',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <Navbar currentPage={page} setPage={setPage} />

      <main className="flex-grow">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {page === 'home' && <HomePage setPage={setPage} />}

            {page === 'regulatory-frameworks' && (
              <EpisodePage
                title="Regulatory Frameworks"
                icon={Scale}
                problem="When companies put data centers in orbit, they trade a five-layer regulatory stack on Earth for a single federal agency, raise unresolved questions about jurisdiction and liability, and hand a growing share of national security infrastructure to a handful of private firms. These are the conversations that came up again and again."
                episodes={regulatoryEpisodes}
              />
            )}

            {page === 'economic-feasibility' && (
              <EpisodePage
                title="Economic Feasibility"
                icon={TrendingUp}
                problem="The economic case for orbital data centers isn't really about whether the math works today. It's about whether the tech industry is racing toward a winner-take-all moment that justifies overspending, or heading for a dot-com-style overbuild that ends in a compute glut and a lot of bankrupt companies. Behind every launch-cost chart is a deeper question about whether scale keeps yielding better AI models, and whether the power grid can keep up with the bet either way."
                episodes={economicEpisodes}
              />
            )}

            {page === 'environment' && (
              <EpisodePage
                title="Environment"
                icon={Leaf}
                problem="The environmental case for orbital data centers isn't a swap, it's a redistribution. Solar power in space, no water cooling, and no local grid strain on one side. Launch emissions, orbital debris, upper-atmosphere ablation on reentry, and a regulatory regime that governs launch and licensing but not lifecycle on the other. The question running through this section is whether we're reducing environmental harm or just moving it somewhere harder to see."
                episodes={environmentEpisodes}
              />
            )}

            {page === 'resources' && <NextPage />}
          </motion.div>
        </AnimatePresence>
      </main>

      <Footer setPage={setPage} />
    </div>
  );
}
