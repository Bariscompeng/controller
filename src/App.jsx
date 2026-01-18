import React, { useEffect, useMemo, useRef, useState } from "react";
import * as ROSLIB from "roslib";
import nipplejs from "nipplejs";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function guessWsUrl() {
  const host = window.location.hostname || "localhost";
  return `ws://${host}:9090`;
}

function prettyErr(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function App() {
  const [wsUrl, setWsUrl] = useState(guessWsUrl());
  const [topicName, setTopicName] = useState("/cmd_vel");

  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState("Bağlı değil");
  const [errorText, setErrorText] = useState("");

  const [linearMax, setLinearMax] = useState(0.6);
  const [angularMax, setAngularMax] = useState(1.2);

  const [estop, setEstop] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [controlMode, setControlMode] = useState("joystick"); 

  const rosRef = useRef(null);
  const cmdVelTopicRef = useRef(null);

  const joystickZoneRef = useRef(null);
  const joystickRef = useRef(null);

  const axesRef = useRef({ x: 0, y: 0 });
  const timerRef = useRef(null);

  const twistTemplate = useMemo(
    () => ({
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    }),
    []
  );

  const publishTwist = (linX, angZ) => {
    const topic = cmdVelTopicRef.current;
    if (!topic) return;

    const msg = {
      ...twistTemplate,
      linear: { x: linX, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angZ },
    };
    topic.publish(msg);
  };

  const safeStop = () => {
    axesRef.current = { x: 0, y: 0 };
    publishTwist(0, 0);
    setTimeout(() => publishTwist(0, 0), 80);
    setTimeout(() => publishTwist(0, 0), 160);
  };

  const disconnect = () => {
    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      cmdVelTopicRef.current = null;
      if (rosRef.current) {
        rosRef.current.close();
        rosRef.current = null;
      }
    } catch (_) {}
    setIsConnected(false);
    setStatusText("Bağlı değil");
  };

  const connect = () => {
    disconnect();
    setStatusText("Bağlanıyor...");
    setErrorText("");

    const ros = new ROSLIB.Ros({ url: wsUrl });
    rosRef.current = ros;

    ros.on("connection", () => {
      setIsConnected(true);
      setStatusText("Bağlandı");

      cmdVelTopicRef.current = new ROSLIB.Topic({
        ros,
        name: topicName,
        messageType: "geometry_msgs/Twist",
      });
    });

    ros.on("close", () => {
      setIsConnected(false);
      setStatusText("Bağlantı kapandı");
      safeStop();
    });

    ros.on("error", (err) => {
      setIsConnected(false);
      setStatusText("Bağlantı hatası");
      setErrorText(prettyErr(err));
      safeStop();
    });
  };

  // Joystick oluşturma - DÜZELTİLMİŞ MERKEZ
  useEffect(() => {
    const zone = joystickZoneRef.current;
    if (!zone || controlMode !== "joystick") return; 

    const create = () => {
      if (joystickRef.current) {
        joystickRef.current.destroy();
        joystickRef.current = null;
      }

      const rect = zone.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);

      
      const size = Math.min(w, h) * 0.7;

      const manager = nipplejs.create({
        zone,
        mode: "static",
        position: { left: "50%", top: "50%" }, 
        color: "#3b82f6",
        size,
        restOpacity: 0.8,
        dynamicPage: true,
      });

      joystickRef.current = manager;

      manager.on("move", (evt, data) => {
        const x = clamp(data.vector.x, -1, 1);
        const y = clamp(data.vector.y, -1, 1);
        axesRef.current = { x, y: -y };
      });

      manager.on("end", () => {
        axesRef.current = { x: 0, y: 0 };
        publishTwist(0, 0); 
      });
    };

    const raf = requestAnimationFrame(create);
    const onResize = () => requestAnimationFrame(create);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (joystickRef.current) {
        joystickRef.current.destroy();
        joystickRef.current = null;
      }
    };
  }, [controlMode]); 


  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      if (!isConnected) return;

      if (estop) {
        publishTwist(0, 0);
        return;
      }

      const { x, y } = axesRef.current;
      const lin = clamp(y * linearMax, -linearMax, linearMax);
      const ang = clamp(x * angularMax, -angularMax, angularMax);
      publishTwist(lin, ang);
    }, 50);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isConnected, estop, linearMax, angularMax]);

  useEffect(() => {
    if (!isConnected || !rosRef.current) return;
    cmdVelTopicRef.current = new ROSLIB.Topic({
      ros: rosRef.current,
      name: topicName,
      messageType: "geometry_msgs/Twist",
    });
    safeStop();
  }, [topicName]);

  return (
    <div style={{ 
      height: '100vh', 
      width: '100vw',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', 
      color: 'white', 
      padding: '0.5rem', 
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      <div style={{ 
        maxWidth: '1400px', 
        margin: '0 auto', 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column',
        gap: '0.5rem'
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🎮</span>
              <h1 style={{ fontSize: '1.125rem', fontWeight: 'bold', margin: 0 }}>SIMSOFT ATOH</h1>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem', background: '#334155', border: 'none', color: 'white', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              ⚙️ {showSettings ? 'Gizle' : 'Ayarlar'}
            </button>
          </div>

          {/* Status Bar */}
          <div style={{ background: '#1e293b', borderRadius: '0.5rem', padding: '0.75rem', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>
                  {isConnected ? '📡' : '📵'}
                </span>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.875rem' }}>{statusText}</div>
                  {errorText && (
                    <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.125rem' }}>{errorText}</div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {!isConnected && (
                  <button
                    onClick={connect}
                    style={{ padding: '0.375rem 0.75rem', background: '#2563eb', border: 'none', borderRadius: '0.375rem', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    🔌 Bağlan
                  </button>
                )}
                {isConnected && (
                  <button
                    onClick={() => { disconnect(); safeStop(); }}
                    style={{ padding: '0.375rem 0.75rem', background: '#475569', border: 'none', borderRadius: '0.375rem', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    ✂️ Kes
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div style={{ background: '#1e293b', borderRadius: '0.5rem', padding: '1rem', marginBottom: '0.75rem', border: '1px solid #334155', flexShrink: 0 }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.75rem', marginTop: 0 }}>
              ⚙️ Ayarlar
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '500', marginBottom: '0.375rem' }}>
                  ROSBridge WebSocket URL
                </label>
                <input
                  type="text"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  placeholder="ws://<robot_ip>:9090"
                  style={{ width: '100%', padding: '0.5rem', background: '#334155', border: '1px solid #475569', borderRadius: '0.375rem', color: 'white', outline: 'none', fontSize: '0.875rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '500', marginBottom: '0.375rem' }}>
                  cmd_vel Topic
                </label>
                <input
                  type="text"
                  value={topicName}
                  onChange={(e) => setTopicName(e.target.value)}
                  placeholder="/cmd_vel"
                  style={{ width: '100%', padding: '0.5rem', background: '#334155', border: '1px solid #475569', borderRadius: '0.375rem', color: 'white', outline: 'none', fontSize: '0.875rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '500', marginBottom: '0.375rem' }}>
                  Linear Max (m/s)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={linearMax}
                  onChange={(e) => setLinearMax(Number(e.target.value))}
                  style={{ width: '100%', padding: '0.5rem', background: '#334155', border: '1px solid #475569', borderRadius: '0.375rem', color: 'white', outline: 'none', fontSize: '0.875rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '500', marginBottom: '0.375rem' }}>
                  Angular Max (rad/s)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={angularMax}
                  onChange={(e) => setAngularMax(Number(e.target.value))}
                  style={{ width: '100%', padding: '0.5rem', background: '#334155', border: '1px solid #475569', borderRadius: '0.375rem', color: 'white', outline: 'none', fontSize: '0.875rem' }}
                />
              </div>
            </div>

            {/* Kontrol Modu Seçimi */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#0f172a', borderRadius: '0.375rem', border: '1px solid #334155' }}>
              <div style={{ fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.875rem' }}>🎮 Kontrol Modu</div>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <button
                  onClick={() => setControlMode("joystick")}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: '0.375rem',
                    border: 'none',
                    background: controlMode === "joystick" ? '#2563eb' : '#334155',
                    color: 'white',
                    cursor: 'pointer',
                    fontWeight: controlMode === "joystick" ? '600' : '400',
                    fontSize: '0.75rem'
                  }}
                >
                  🕹️ Joystick
                </button>
                <button
                  onClick={() => {
                    setControlMode("buttons");
                    safeStop();
                  }}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: '0.375rem',
                    border: 'none',
                    background: controlMode === "buttons" ? '#2563eb' : '#334155',
                    color: 'white',
                    cursor: 'pointer',
                    fontWeight: controlMode === "buttons" ? '600' : '400',
                    fontSize: '0.75rem'
                  }}
                >
                  🎯 Butonlar
                </button>
              </div>
            </div>

            {/* Joystick Veri Açıklaması */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#0f172a', borderRadius: '0.375rem', border: '1px solid #334155' }}>
              <div style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
                <div style={{ fontWeight: '600', marginBottom: '0.375rem' }}>📊 cmd_vel Veri Formatı</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.625rem', color: '#60a5fa' }}>
                  <div>• İleri tam: linear.x = +{linearMax} m/s</div>
                  <div>• Geri tam: linear.x = -{linearMax} m/s</div>
                  <div>• Sola tam: angular.z = +{angularMax} rad/s</div>
                  <div>• Sağa tam: angular.z = -{angularMax} rad/s</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Control Grid - FLEXİBLE */}
        <div style={{ 
          flex: 1, 
          display: 'grid', 
          gridTemplateColumns: window.innerWidth < 768 ? '1fr' : 'repeat(2, 1fr)', 
          gap: '0.75rem',
          minHeight: 0,
          overflow: 'auto'
        }}>
          {/* Joystick Panel */}
          {controlMode === "joystick" && (
            <div style={{ background: '#1e293b', borderRadius: '0.5rem', padding: '1rem', border: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.75rem', marginTop: 0, flexShrink: 0 }}>
                🕹️ Joystick Kontrol
              </h2>
              
              <div
                ref={joystickZoneRef}
                style={{
                  flex: 1,
                  minHeight: '250px',
                  maxHeight: '500px',
                  aspectRatio: '1',
                  borderRadius: '0.75rem',
                  background: '#0f172a',
                  border: '2px dashed #475569',
                  position: 'relative',
                  overflow: 'hidden',
                  touchAction: 'none',
                  userSelect: 'none'
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: '#64748b',
                  pointerEvents: 'none',
                  textAlign: 'center'
                }}>
                  <div>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>🎮</div>
                    <div style={{ fontSize: '0.75rem' }}>İleri/Geri + Sağ/Sol</div>
                    <div style={{ fontSize: '0.625rem', marginTop: '0.25rem', color: '#475569' }}>Bırakınca durur</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Button Panel */}
          {controlMode === "buttons" && (
            <div style={{ background: '#1e293b', borderRadius: '0.5rem', padding: '1rem', border: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.75rem', marginTop: 0, flexShrink: 0 }}>
                🎯 Buton Kontrol
              </h2>
              
              <div style={{ 
                flex: 1,
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr 1fr', 
                gap: '0.5rem',
                minHeight: '250px',
                maxHeight: '500px',
                aspectRatio: '1'
              }}>
                {/* Sol Üst - İleri + Sol */}
                <button
                  onPointerDown={() => { axesRef.current = { x: -0.7, y: 1 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#334155',
                    border: 'none',
                    borderRadius: '0.5rem',
                    color: 'white',
                    fontSize: window.innerWidth < 768 ? '1.25rem' : '1.5rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ↖️
                </button>

                {/* Üst - İleri */}
                <button
                  onPointerDown={() => { axesRef.current = { x: 0, y: 1 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '0.5rem',
                    color: 'white',
                    fontSize: window.innerWidth < 768 ? '1.75rem' : '2rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ⬆️
                </button>

                {/* Sağ Üst - İleri + Sağ */}
                <button
                  onPointerDown={() => { axesRef.current = { x: 0.7, y: 1 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#334155',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: 'white',
                    fontSize: '1.5rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ↗️
                </button>

                {/* Sol - Sola Dön */}
                <button
                  onPointerDown={() => { axesRef.current = { x: -1, y: 0 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: 'white',
                    fontSize: '2rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ⬅️
                </button>

                {/* Merkez - Dur */}
                <button
                  onClick={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#dc2626',
                    border: 'none',
                    borderRadius: '0.5rem',
                    color: 'white',
                    fontSize: window.innerWidth < 768 ? '1.25rem' : '1.5rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1,
                    fontWeight: 'bold',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ⏹️
                  <span style={{ fontSize: window.innerWidth < 768 ? '0.625rem' : '0.75rem', marginTop: '0.25rem' }}>DUR</span>
                </button>

                {/* Sağ - Sağa Dön */}
                <button
                  onPointerDown={() => { axesRef.current = { x: 1, y: 0 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: 'white',
                    fontSize: '2rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ➡️
                </button>

                {/* Sol Alt - Geri + Sol */}
                <button
                  onPointerDown={() => { axesRef.current = { x: -0.7, y: -1 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#334155',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: 'white',
                    fontSize: '1.5rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ↙️
                </button>

                {/* Alt - Geri */}
                <button
                  onPointerDown={() => { axesRef.current = { x: 0, y: -1 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: 'white',
                    fontSize: '2rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ⬇️
                </button>

                {/* Sağ Alt - Geri + Sağ */}
                <button
                  onPointerDown={() => { axesRef.current = { x: 0.7, y: -1 }; }}
                  onPointerUp={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  onPointerLeave={() => { axesRef.current = { x: 0, y: 0 }; publishTwist(0, 0); }}
                  disabled={estop}
                  style={{
                    background: '#334155',
                    border: 'none',
                    borderRadius: '0.75rem',
                    color: 'white',
                    fontSize: '1.5rem',
                    cursor: estop ? 'not-allowed' : 'pointer',
                    opacity: estop ? 0.3 : 1
                  }}
                >
                  ↘️
                </button>
              </div>

              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', flexShrink: 0 }}>
                Basılı tut = Hareket • Bırak = Dur
              </div>
            </div>
          )}

          {/* Control Panel - E-STOP */}
          <div style={{ background: '#1e293b', borderRadius: '0.5rem', padding: '1rem', border: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '0.75rem', marginTop: 0, flexShrink: 0 }}>
              ⚠️ Acil Durdurma
            </h2>
            
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', alignItems: 'stretch' }}>
              <button
                onClick={() => { setEstop(true); safeStop(); }}
                style={{
                  padding: window.innerWidth < 768 ? '1.5rem 1rem' : '2rem 1.5rem',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: '0.5rem',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: window.innerWidth < 768 ? '0.875rem' : '1.125rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <span style={{ fontSize: window.innerWidth < 768 ? '1.5rem' : '2rem' }}>🛑</span>
                ACİL DURDUR
              </button>

              <button
                onClick={() => { setEstop(false); safeStop(); }}
                style={{
                  padding: window.innerWidth < 768 ? '1.5rem 1rem' : '2rem 1.5rem',
                  background: estop ? '#16a34a' : '#334155',
                  border: 'none',
                  borderRadius: '0.5rem',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: window.innerWidth < 768 ? '0.875rem' : '1.125rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <span style={{ fontSize: window.innerWidth < 768 ? '1.5rem' : '2rem' }}>✅</span>
                E-STOP ÇÖZ
              </button>
            </div>

            {estop && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(220, 38, 38, 0.2)', border: '1px solid #dc2626', borderRadius: '0.375rem', textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontWeight: 'bold', color: '#f87171', fontSize: '0.75rem' }}>⚠️ ACİL DURDURMA AKTİF</div>
                <div style={{ fontSize: '0.625rem', marginTop: '0.125rem' }}>Robot hareket edemez</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div style={{ marginTop: '0.75rem', textAlign: 'center', fontSize: '0.625rem', color: '#64748b', flexShrink: 0 }}>
          <div>Mobil ve masaüstü uyumlu • Real-time ROS kontrol</div>
          <div style={{ marginTop: '0.125rem' }}>Topic: <code style={{ color: '#60a5fa' }}>{topicName}</code></div>
        </div>
      </div>
    </div>
  );
}
