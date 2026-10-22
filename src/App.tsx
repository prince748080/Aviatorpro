import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar.js';
import { RoundHistory } from './components/RoundHistory.js';
import { AviatorCanvas } from './components/AviatorCanvas.js';
import { BetPanel } from './components/BetPanel.js';
import { LiveBetsList } from './components/LiveBetsList.js';
import { RulesModal } from './components/RulesModal.js';
import { ProvablyFairModal } from './components/ProvablyFairModal.js';
import { AuthModal } from './components/AuthModal.js';
import { AdminDashboard } from './components/AdminDashboard.js';
import { api } from './utils/api.js';
import { sounds } from './utils/sound.js';
import {
  User,
  GameRound,
  RoundState,
  Bet,
  GameConfig,
  WsMessage,
} from './types/index.js';

export default function App() {
  // Application State
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [connected, setConnected] = useState<boolean>(false);

  // Game Engine Real-Time State
  const [roundState, setRoundState] = useState<RoundState>('WAITING');
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1.0);
  const [countdownSec, setCountdownSec] = useState<number>(5.0);
  const [activeRound, setActiveRound] = useState<GameRound | null>(null);
  const [lastCrashMultiplier, setLastCrashMultiplier] = useState<number | null>(null);
  const [recentRounds, setRecentRounds] = useState<GameRound[]>([]);
  const [activeBets, setActiveBets] = useState<Bet[]>([]);

  // User's Local Bets in Current Round (Slot 0 and Slot 1)
  const [userBet0, setUserBet0] = useState<Bet | null>(null);
  const [userBet1, setUserBet1] = useState<Bet | null>(null);

  // Modals
  const [rulesOpen, setRulesOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [selectedFairRound, setSelectedFairRound] = useState<GameRound | null>(null);

  const activeRoundRef = useRef<GameRound | null>(null);
  const userRef = useRef<User | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // 1. Initialize User & Initial Config
  useEffect(() => {
    const initApp = async () => {
      try {
        const token = api.getToken();
        if (token) {
          const me = await api.getMe();
          setUser(me.user);
        } else {
          // Auto login default demo pilot for immediate seamless evaluation
          try {
            const loginRes = await api.login('pilot', 'DemoPilot123!');
            setUser(loginRes.user);
          } catch {
            // Manual sign-in available
          }
        }
      } catch (err) {
        console.warn('Initial session check:', err);
      }

      try {
        const cfg = await api.getConfig();
        setConfig(cfg.config);
      } catch (err) {
        console.warn('Initial config load:', err);
      }
    };

    initApp();
  }, []);

  // 2. Real-Time WebSocket Connection
  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isSubscribed = true;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isSubscribed) return;
        setConnected(true);

        // Periodic ping
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!isSubscribed) return;
        try {
          const msg: WsMessage = JSON.parse(event.data);
          handleWebSocketMessage(msg);
        } catch (err) {
          console.error('Error processing WS packet:', err);
        }
      };

      ws.onclose = () => {
        if (!isSubscribed) return;
        setConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        // Automatic reconnection
        reconnectTimer = setTimeout(connectWebSocket, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWebSocket();

    return () => {
      isSubscribed = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // WebSocket Event Dispatcher
  const handleWebSocketMessage = (msg: WsMessage) => {
    switch (msg.type) {
      case 'INITIAL_STATE': {
        const { round, state, currentMultiplier, waitingCountdown, activeBets, recentRounds, config } = msg.payload;
        setActiveRound(round);
        activeRoundRef.current = round;
        setRoundState(state);
        setCurrentMultiplier(currentMultiplier);
        setCountdownSec(waitingCountdown);
        setActiveBets(activeBets || []);
        if (recentRounds) setRecentRounds(recentRounds);
        if (config) setConfig(config);

        // Restore active user bets if present
        if (activeBets && activeBets.length > 0) {
          const currentUser = userRef.current;
          if (currentUser) {
            const myBets = (activeBets as Bet[]).filter(
              (b) => b.userId === currentUser.id || b.username === currentUser.username
            );
            if (myBets[0]) setUserBet0(myBets[0]);
            if (myBets[1]) setUserBet1(myBets[1]);
          }
        }
        break;
      }

      case 'ROUND_WAITING': {
        sounds.stopFlightSound();
        setRoundState('WAITING');
        setCurrentMultiplier(1.0);
        const incomingRound = msg.payload.round;
        setActiveRound(incomingRound);
        setCountdownSec(msg.payload.countdownSec);

        // CRITICAL: Only reset user local bet slots when transitioning to a NEW round!
        if (incomingRound && incomingRound.id !== activeRoundRef.current?.id) {
          activeRoundRef.current = incomingRound;
          setUserBet0(null);
          setUserBet1(null);
        }
        break;
      }

      case 'ROUND_COUNTDOWN': {
        setCountdownSec(msg.payload.countdownSec);
        break;
      }

      case 'ROUND_START': {
        setRoundState('RUNNING');
        setCurrentMultiplier(1.0);
        sounds.startFlightSound(1.0);
        // Ensure roundRef is set and user bets remain intact
        if (msg.payload.roundId && activeRoundRef.current) {
          activeRoundRef.current.status = 'RUNNING';
        }
        break;
      }

      case 'ROUND_TICK': {
        setCurrentMultiplier(msg.payload.multiplier);
        sounds.updateFlightPitch(msg.payload.multiplier);
        break;
      }

      case 'ROUND_CRASH': {
        sounds.playCrash();
        setRoundState('CRASHED');
        setCurrentMultiplier(msg.payload.crashMultiplier);
        setLastCrashMultiplier(msg.payload.crashMultiplier);
        if (msg.payload.recentRounds) {
          setRecentRounds(msg.payload.recentRounds);
        }
        // Mark any remaining active placed bets as crashed
        setUserBet0((prev) => (prev && prev.status === 'PLACED' ? { ...prev, status: 'CRASHED' } : prev));
        setUserBet1((prev) => (prev && prev.status === 'PLACED' ? { ...prev, status: 'CRASHED' } : prev));
        refreshUserWallet();
        break;
      }

      case 'BET_PLACED': {
        setActiveBets((prev) => [msg.payload.bet, ...prev]);
        break;
      }

      case 'BET_CASHOUT': {
        const { betId, cashedMultiplier, cashedAmount } = msg.payload;
        setActiveBets((prev) =>
          prev.map((b) =>
            b.id === betId
              ? {
                  ...b,
                  status: 'CASHED_OUT',
                  cashedMultiplier,
                  cashedAmount,
                }
              : b
          )
        );
        // If this cashout belongs to local user (e.g. via auto-cashout), update local state
        setUserBet0((prev) =>
          prev && prev.id === betId
            ? { ...prev, status: 'CASHED_OUT', cashedMultiplier, cashedAmount }
            : prev
        );
        setUserBet1((prev) =>
          prev && prev.id === betId
            ? { ...prev, status: 'CASHED_OUT', cashedMultiplier, cashedAmount }
            : prev
        );
        refreshUserWallet();
        break;
      }

      case 'BET_CANCELLED': {
        setActiveBets((prev) => prev.filter((b) => b.id !== msg.payload.betId));
        break;
      }

      case 'CONFIG_UPDATED': {
        setConfig(msg.payload);
        break;
      }
    }
  };

  const refreshUserWallet = async () => {
    try {
      if (api.getToken()) {
        const me = await api.getMe();
        setUser(me.user);
      }
    } catch {
      // Ignore
    }
  };

  // User Actions
  const handlePlaceBet = async (panelIndex: number, amount: number, autoCashout: number | null) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    const currentRoundId = activeRoundRef.current?.id || activeRound?.id || `rnd_${Date.now()}`;
    const idempotencyKey = `bet_${user.id}_slot${panelIndex}_${currentRoundId}_${Date.now()}`;
    const res = await api.placeBet(amount, autoCashout, idempotencyKey);

    if (panelIndex === 0) {
      setUserBet0(res.bet);
    } else {
      setUserBet1(res.bet);
    }
    setUser((prev) => (prev ? { ...prev, balance: res.newBalance } : null));
  };

  const handleCancelBet = async (panelIndex: number, betId: string) => {
    const res = await api.cancelBet(betId);
    if (panelIndex === 0) setUserBet0(null);
    else setUserBet1(null);
    setUser((prev) => (prev ? { ...prev, balance: res.newBalance } : null));
  };

  const handleCashout = async (panelIndex: number, betId: string) => {
    // Calling cashout without targetMultiplier lets the server award the exact authoritative multiplier
    const res = await api.cashout(betId);
    if (panelIndex === 0 && userBet0) {
      setUserBet0({
        ...userBet0,
        status: 'CASHED_OUT',
        cashedMultiplier: res.cashedMultiplier,
        cashedAmount: res.cashedAmount,
      });
    } else if (panelIndex === 1 && userBet1) {
      setUserBet1({
        ...userBet1,
        status: 'CASHED_OUT',
        cashedMultiplier: res.cashedMultiplier,
        cashedAmount: res.cashedAmount,
      });
    }
    setUser((prev) => (prev ? { ...prev, balance: res.newBalance } : null));
  };

  const handleReloadCredits = async () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    try {
      sounds.playClick();
      const res = await api.reloadDemoCredits();
      setUser((prev) => (prev ? { ...prev, balance: res.newBalance } : null));
    } catch (err: any) {
      alert(err.message || 'Failed to reload credits');
    }
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
    setUserBet0(null);
    setUserBet1(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0b10] text-zinc-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        user={user}
        config={config}
        connected={connected}
        onOpenRules={() => setRulesOpen(true)}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        onOpenProvablyFair={() => setSelectedFairRound(recentRounds[0] || activeRound)}
        onReloadCredits={handleReloadCredits}
        onLogout={handleLogout}
      />

      {/* Round History Bar */}
      <RoundHistory
        rounds={recentRounds}
        onSelectRound={(round) => setSelectedFairRound(round)}
      />

      {/* Main Arena Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-2 sm:p-4 md:p-5 flex flex-col gap-4">
        {/* Top Section: Flight Canvas + Live Bets Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          {/* Flight Arena Canvas */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            <AviatorCanvas
              roundState={roundState}
              currentMultiplier={currentMultiplier}
              countdownSec={countdownSec}
              activeRound={activeRound}
              lastCrashMultiplier={lastCrashMultiplier}
              connected={connected}
            />

            {/* Dual Betting Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <BetPanel
                panelIndex={0}
                roundState={roundState}
                currentMultiplier={currentMultiplier}
                config={config}
                activeBet={userBet0}
                userBalance={user?.balance || 0}
                disabled={!connected}
                onPlaceBet={(amt, auto) => handlePlaceBet(0, amt, auto)}
                onCancelBet={(id) => handleCancelBet(0, id)}
                onCashout={(id) => handleCashout(0, id)}
              />

              <BetPanel
                panelIndex={1}
                roundState={roundState}
                currentMultiplier={currentMultiplier}
                config={config}
                activeBet={userBet1}
                userBalance={user?.balance || 0}
                disabled={!connected}
                onPlaceBet={(amt, auto) => handlePlaceBet(1, amt, auto)}
                onCancelBet={(id) => handleCancelBet(1, id)}
                onCashout={(id) => handleCashout(1, id)}
              />
            </div>
          </div>

          {/* Right Section: Live Bets List */}
          <div className="lg:col-span-1 h-full">
            <LiveBetsList bets={activeBets} />
          </div>
        </div>

        {/* Responsible Play & Transparency Footer Note */}
        <div className="mt-auto pt-4 border-t border-[#181a24] text-center text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Aviator Pro operates on an authoritative backend engine with a documented <strong>2.00x maximum multiplier cap</strong>.
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setRulesOpen(true)}
              className="text-zinc-400 hover:text-white underline cursor-pointer"
            >
              Documented Rules
            </button>
            <span>•</span>
            <span className="text-amber-500/80">Demo Credits Only</span>
          </div>
        </div>
      </main>

      {/* Modals */}
      <RulesModal
        isOpen={rulesOpen}
        onClose={() => setRulesOpen(false)}
        config={config}
      />

      <ProvablyFairModal
        isOpen={selectedFairRound !== null}
        onClose={() => setSelectedFairRound(null)}
        round={selectedFairRound}
      />

      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={(u) => setUser(u)}
      />

      <AdminDashboard
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        currentUser={user}
      />
    </div>
  );
}
