// frontend/src/Chat.jsx

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { v4 as uuidv4 } from 'uuid';
import './Chat.css';
import { SYSTEM_TEMPLATES, STYLE_INSTRUCTIONS, ANALYSIS_TOOLS} from './config.js';
import logo from './assets/logo.png';

function Chat() {
  // --- ESTADOS ---
  const [messages, setMessages] = useState([
    { id: uuidv4(), role: 'assistant', content: 'Hola Julio', type:'welcome' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [tema, setTema] = useState("Cultura General");
  const [grado, setGrado] = useState("5° de secundaria");
  const [style, setStyle] = useState("Normal");
  const [tools, setTools] = useState("Herramientas");

  const [savedChats, setSavedChats] = useState([]);
  
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  // --- ESTADO MICRÓFONO---
  const [isListening, setIsListening] = useState(false);

  // --- REFERENCIAS ---
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const isWelcomeState = messages.length === 1 && messages[0].type === 'welcome';

  
  useEffect(() => {
    // 1. Encuentra el último mensaje que fue enviado por el 'user'
    
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

    // 2. Si encontramos uno...
    if (lastUserMessage) {
      // 3. ...buscamos su elemento correspondiente en el DOM por su ID.
      const targetElement = document.getElementById(lastUserMessage.id);

      // 4. Si el elemento existe en la página...
      if (targetElement) {
        // 5. ...le decimos al navegador que desplace la vista hasta que
        // ese elemento quede en la parte superior ('start') de la zona visible.
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [messages]); // Se ejecuta cada vez que la lista de mensajes cambia.


  // Este useEffect activa el cursor
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isWelcomeState, sessionId]);


  // --- MANEJADORES Y FUNCIONES DE AYUDA ---

  const updateSavedChatHistory = (sessionIdToUpdate, newMessages) => {
    setSavedChats(prevChats =>
      prevChats.map(chat =>
        chat.id === sessionIdToUpdate ? { ...chat, messages: newMessages } : chat
      )
    );
  };
  
  const handleNewChat = () => {
    console.log("--- Limpiando para un nuevo chat ---");
  
    // 1. Resetea el ID de la sesión actual a null.
    setSessionId(null);
  
    // 2. Vuelve a poner el mensaje de bienvenida.
    setMessages([
      { id: uuidv4(), role: 'assistant', content: 'Hola Julio', type: 'welcome' }
    ]);
  
    // 3. Limpia el área de texto.
    setInputValue('');
    setTools("Herramientas");
  };
  
  const handleLoadChat = (chatToLoad) => {
    console.log("Cargando chat:", chatToLoad.id);
    setSessionId(chatToLoad.id);
    setMessages(chatToLoad.messages);
  };

  const handleFileChange = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    // if (!sessionId) {
    //   alert("Por favor, envía al menos un mensaje para iniciar una sesión antes de subir archivos.");
    //   return;
    // }
    const uploadingMessage = { role: 'assistant', content: 'Subiendo y procesando archivos, por favor espera...' };
    setMessages(prev => [...prev, uploadingMessage]);

    let currentSessionId = sessionId;

    if (!currentSessionId) { // <--- AÑADE ESTE BLOQUE 'if'
      try {
        console.log("Micrófono 2: No hay sessionId, entrando al bloque 'if' para crear uno."); // Micrófono A
        const newSessionResponse = await fetch('http://127.0.0.1:8000/new_chat', { method: 'POST' });
        const newSessionData = await newSessionResponse.json();
        currentSessionId = newSessionData.session_id;
        setSessionId(currentSessionId);
        console.log("Micrófono 3: Nueva sesión creada con éxito. ID:", currentSessionId);
      } catch (error) {
        console.error("Micrófono 4: FALLÓ la creación de la sesión.", error);
        alert("Error al iniciar una nueva sesión para subir el archivo.");
        return;
      }
    }

    const formData = new FormData();
    formData.append('session_id', currentSessionId);
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    try {
      const response = await fetch('http://127.0.0.1:8000/upload', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Error del servidor: ${errorData.detail || response.status}`);
      }
      const result = await response.json();
      const successMessage = { role: 'assistant', content: `Archivos procesados: ${result.processed_files.join(', ')}` };
      setMessages(prev => [...prev, successMessage]);
    } catch (error) {
      console.error('Error al subir archivos:', error);
      const errorMessage = { role: 'assistant', content: `Hubo un problema al subir los archivos: ${error.message}` };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const toggleMessageExpansion = (messageId) => {
    setMessages(prevMessages =>
      prevMessages.map(msg =>
        msg.id === messageId ? { ...msg, isExpanded: !msg.isExpanded } : msg
      )
    );
  };


  const handleSendMessage = async () => {
    console.log(`%cFUNCIÓN LLAMADA: handleSendMessage`, 'color: red; font-weight: bold;');
    
    if (!inputValue.trim()) return;
    const newUserMessage = { 
      id: uuidv4(), role: 'user', content: inputValue,
      isLong: inputValue.length > 280, // ¿Es un mensaje largo? (ajusta 280 si quieres)
      isExpanded: false };
    const currentInputValue = inputValue;
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    
    // Mostramos el mensaje del usuario inmediatamente
    
    const updatedMessagesWithUser = (
      messages.length === 1 && messages[0].type === 'welcome'
    ) ? [newUserMessage] // Si es el primer mensaje, reemplaza la bienvenida.
      : [...messages, newUserMessage]; // Si no, añade el mensaje.
    
    // 1. Creamos un mensaje temporal de "cargando".


    //    Le damos un 'type' especial para poder identificarlo después.
    const loadingId = uuidv4();
    const loadingMessage = {
      id: loadingId,
      role: 'assistant',
      content: 'Un momento...',
      type: 'loading' // Esta "etiqueta" será muy útil más adelante
    };

    // 2. Actualizamos la pantalla para mostrar TU mensaje Y el de "cargando".
    setMessages([...updatedMessagesWithUser, loadingMessage]);



    let currentSessionId = sessionId;
    
    try {
      if (!currentSessionId) {
        const newSessionResponse = await fetch('http://127.0.0.1:8000/new_chat', { method: 'POST' });
        const newSessionData = await newSessionResponse.json();
        currentSessionId = newSessionData.session_id;
        setSessionId(currentSessionId);
        
        const initialMessages = [newUserMessage];
        const newChatInfo = {
          id: currentSessionId,
          title: `Chat - ${new Date().toLocaleTimeString()}`,
          messages: initialMessages,
        };
        setSavedChats(prevChats => [newChatInfo, ...prevChats]);
      }
      
      console.log("%c1. Preparando para llamar a /chat_stream...", "color: orange;");
      const chatResponse = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: currentSessionId,
          user_message: currentInputValue,
          tema,
          grado,
          style,
        }),
      });
      
      console.log("%c2. Llamada a fetch completada. Respuesta recibida.", "color: orange;");

      if (!chatResponse.ok) {
        console.error("Respuesta no OK:", chatResponse);
        const errorData = await chatResponse.json(); // Intenta leer el detalle del error del backend
        throw new Error(`Error de API: ${errorData.detail || chatResponse.status}`);
      }
      
      // Procesamos la respuesta JSON que nos da el endpoint /chat
      const result = await chatResponse.json();
      const aiResponse = result.ai_response;

      // Actualizamos el mensaje de "cargando..." con la respuesta final
      setMessages(prev =>
        prev.map(m =>
          m.id === loadingId ? { ...m, type: 'final', content: aiResponse } : m
        )
      );

      // Guardamos el historial completo en el panel lateral
      const finalMessages = [
        ...updatedMessagesWithUser,
        { id: loadingId, role: 'assistant', content: aiResponse },
      ];
      updateSavedChatHistory(currentSessionId, finalMessages);
     
      
    } catch (error) {
      console.error('%c¡ERROR EN EL BLOQUE TRY-CATCH!', 'color: red; font-weight: bold;', error);
      console.error('Error al conectar con la API:', error);
      const errorMessage = {id: uuidv4(), role: 'assistant', content: `Error: No se pudo conectar con el asistente. ${error.message}` };
      
      const errorMessages = [...updatedMessagesWithUser, errorMessage];
      setMessages(errorMessages);

      if (currentSessionId) {
          updateSavedChatHistory(currentSessionId, errorMessages);
      }
    }
  
  
  
  };

  const handleAnalysis = async (analysisType) => {
    console.log(`%c1. Iniciando handleAnalysis para "${analysisType}"`, 'color: blue;');
  
    if (!sessionId) {
      alert("Inicia una conversación antes de solicitar un análisis.");
      return;
    }
  
    const analysisInProgressMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `Generando ${analysisType.toLowerCase()}...`,
      type: 'loading'
    };
    setMessages(prev => [...prev, analysisInProgressMessage]);
  
    try {
      console.log('%c2. Dentro del try, a punto de hacer fetch...', 'color: blue;');
      
      const response = await fetch('http://127.0.0.1:8000/analyze_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          analysis_type: analysisType,
        }),
      });
  
      console.log('%c3. Fetch completado. Status:', 'color: blue;', response.status);
  
      if (!response.ok) {
        console.error('La respuesta del servidor no fue OK.');
        throw new Error(`Error del servidor: ${response.status}`);
      }
  
      console.log('%c4. A punto de procesar response.json()...', 'color: blue;');
      const data = await response.json();
      console.log('%c5. JSON procesado. Data recibida:', 'color: blue;', data);
      
      const analysisResult = {
        id: uuidv4(),
        role: 'assistant',
        content: data.analysis_result,
      };
  
      setMessages(prev => [
        ...prev.filter(msg => msg.id !== analysisInProgressMessage.id),
        analysisResult
      ]);
  
      console.log('%c6. Mensaje de análisis mostrado con éxito.', 'color: blue;');
  
    } catch (error) {
      // --- ESTE BLOQUE ES EL MÁS IMPORTANTE AHORA ---
      console.error('%c¡ERROR! Se ha producido una excepción en el bloque try.', 'color: red; font-weight: bold;', error);
      
      const errorMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `Hubo un error al generar el análisis: ${error.message}`
      };
      setMessages(prev => [
          ...prev.filter(msg => msg.id !== analysisInProgressMessage.id),
          errorMessage
      ]);
    }
  };
  

  // --- LÓGICA DEL MICRÓFONO (VERSIÓN FIEL AL ORIGINAL) ---
  const recognitionRef = useRef(null);
  const listeningRef = useRef(false); // Usamos una ref para el estado de escucha, para evitar re-renders

  // Inicializamos el reconocimiento de voz solo una vez.
  if (!recognitionRef.current) {
      if ('webkitSpeechRecognition' in window) {
          const SpeechRecognition = window.webkitSpeechRecognition;
          const recognition = new SpeechRecognition();
          recognition.continuous = true; // La clave está aquí
          recognition.lang = 'es-ES';
          recognition.interimResults = false;

          recognition.onresult = (event) => {
              let finalTranscript = '';
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                  if (event.results[i].isFinal) {
                      finalTranscript += event.results[i][0].transcript;
                  }
              }
              if (finalTranscript) {
                  setInputValue(prev => prev.trim() ? `${prev.trim()} ${finalTranscript.trim()}` : finalTranscript.trim());
              }
          };

          recognition.onend = () => {
              // Si listeningRef.current es true, significa que el navegador
              // se detuvo, pero nosotros queremos continuar.
              if (listeningRef.current) {
                  console.log("Micrófono se detuvo, reiniciando...");
                  recognition.start();
              }
          };
          
          recognition.onerror = (event) => {
              console.error("Error de reconocimiento:", event.error);
              listeningRef.current = false;
              setIsListening(false);
          };

          recognitionRef.current = recognition;
      } else {
          console.error("Reconocimiento de voz no soportado.");
      }
  }

  const handleMicClick = () => {
      if (recognitionRef.current) {
          if (listeningRef.current) {
              // El usuario quiere parar
              listeningRef.current = false;
              recognitionRef.current.stop();
              setIsListening(false);
              console.log("Micrófono detenido por el usuario.");
          } else {
              // El usuario quiere empezar
              listeningRef.current = true;
              recognitionRef.current.start();
              setIsListening(true);
              console.log("Micrófono iniciado.");
          }
      }
  };

  const handleInputChange = (event) => {
      // 1. Actualiza el estado con el nuevo texto
      setInputValue(event.target.value);

      // 2. Ajusta la altura del textarea
      const textarea = textareaRef.current;
      if (textarea) {
          // Resetea la altura para que pueda encogerse si se borra texto
          textarea.style.height = 'auto'; 
          // Establece la nueva altura basada en el contenido
          textarea.style.height = `${textarea.scrollHeight}px`;
      }
  };

  

  // --- RENDERIZADO DEL COMPONENTE (JSX) ---
  return (
    <div className={
      `chat-container` +
      `${!isSidebarVisible ? ' sidebar-collapsed' : ''}` +
      `${isWelcomeState ? ' main-container-gradient-bg' : ''}`}>
      
        <div className={`sidebar ${!isWelcomeState ? 'sidebar-gradient-bg' : ''}`}>
          <div className="sidebar-header">
            <img src={logo} alt="Logo del Asistente" className="sidebar-logo" />
            <button 
              className="sidebar-toggle-btn" 
              // Al hacer clic, invertimos el valor de isSidebarVisible (de true a false y viceversa)
              onClick={() => setIsSidebarVisible(!isSidebarVisible)}
            >
              {/* Mostramos una flecha u otra dependiendo del estado */}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"/>
              </svg>
            </button>
          </div>
          <button className="new-chat-btn" onClick={handleNewChat}>
          <svg xmlns="http://www.w3.org/2000/svg" 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              stroke-width="2" 
              stroke-linecap="round" 
              stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"></path>
          </svg>
            <span>Nuevo Chat</span>
          </button>
          <div className="settings">
            <div className="setting-item-expert">
              <label>Tema del experto:</label>
              <div className="select-wrapper">
                <select value={tema} onChange={(e) => setTema(e.target.value)}>
                  {Object.keys(SYSTEM_TEMPLATES).map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setting-item-grado">    
              <label>Grado:</label>
              <div className="select-wrapper">
                <select value={grado} onChange={(e) => setGrado(e.target.value)}>
                  {[1, 2, 3, 4, 5].map(num => (
                    <option key={num} value={`${num}° de secundaria`}>{`${num}° de secundaria`}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>  
          <div className="chats-list-title">Recientes</div>
          <div className="saved-chats-list">
            {savedChats.map(chat => (
              <button 
                key={chat.id} 
                className={`saved-chat-item ${chat.id === sessionId ? 'active' : ''}`}
                onClick={() => handleLoadChat(chat)}
              >
                {chat.title}
              </button>
            ))}
          
        </div>
      </div>
      
      <div className="main-content">

        <div className="chat-window">
          {messages.map((msg) => (
            <div key={`${msg.id}-${msg.type}`} 
                  id={msg.id} 
                  className={
                    `message ${msg.role} ${msg.type === 'welcome' ? 'welcome' : ''} ${msg.type === 'loading' ? 'loading' : ''}` + 
                    `${(msg.isLong && !msg.isExpanded) ? ' collapsed' : ''}`
                    }>
               {msg.type === 'loading' ? (
                    <>
                      {/* Este div será nuestro icono animado */}
                      <svg className="loading-circle-spinner" viewBox="0 0 32 32">
                        {/* 1. Definición del degradado de color */}
                        <defs>
                          <linearGradient id="spinner-gradient">
                            <stop offset="0%" stopColor="#9901f1" />    {/* Morado en el inicio */}
                            <stop offset="50%" stopColor="#f18d01" />    {/* Naranja en el medio */}
                            <stop offset="100%" stopColor="#0969da" />   {/* Azul al final */}

                          </linearGradient>
                        </defs>

                        {/* 2. Círculo de fondo (el gris que ya tenías) */}
                        <circle className="spinner-background" cx="16" cy="16" r="14"></circle>

                        {/* 3. Círculo del frente (este es el nuevo) */}
                        <circle className="spinner-foreground" cx="16" cy="16" r="14"></circle>
                      </svg>

                      {/* Mostramos el contenido del mensaje (ej: "Un momento...") */}
                      <span>{msg.content}</span>
                    </>
                  ) : msg.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                            // "Oye ReactMarkdown, cuando encuentres una tabla (`table`)..."
                            table: ({node, ...props}) => {
                            // 1. Creamos la "etiqueta" para nuestra tabla.
                            const tableRef = useRef(null);
      
                            // 2. Definimos qué pasa cuando se hace clic.
                            const handleCopy = () => {
                              // Nos aseguramos de que la tabla existe.
                              if (tableRef.current) {
                                const tableHTML = tableRef.current.outerHTML;
                                try {
                                  // Creamos un "ClipboardItem" que contiene el HTML.
                                  // Esto es lo que entienden las aplicaciones como Word.
                                  const blob = new Blob([tableHTML], { type: 'text/html' });
                                  const item = new ClipboardItem({ 'text/html': blob });
      
                                  // Usamos la función 'write' para enviarlo al portapapeles.
                                  navigator.clipboard.write([item]);
                                  
                                  console.log("Tabla copiada como HTML!");
      
                                } catch (error) {
                                  // Si el navegador no soporta el método moderno, usamos el antiguo.
                                  console.error("No se pudo copiar como HTML, usando texto plano como alternativa:", error);
                                  navigator.clipboard.writeText(tableRef.current.innerText);
                                }
                              }
                            };
                            // Este SVG es para el ícono de dos papeles superpuestos (portapapeles).
                            const CopyIcon = () => (
                              <svg
                                width="18"
                                height="20"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <defs>
                                  {/* <!-- Máscara: recorta la zona ocupada por el cuadrado delantero --> */}
                                  <mask id="cutOverlap">
                                    {/* <!-- área visible por defecto --> */}
                                    <rect width="24" height="24" fill="white"/>
                                    {/* <!-- zona a ocultar (la forma del cuadrado delantero) --> */}
                                    <rect x="4" y="8" width="12" height="12" rx="2" fill="black"/>
                                  </mask>
                                </defs>
      
                                {/* <!-- Cuadrado de atrás (máscara aplicada para recortar el solapamiento) --> */}
                                <rect
                                  x="8"
                                  y="4"
                                  width="12"
                                  height="12"
                                  rx="2"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  mask="url(#cutOverlap)"
                                />
      
                                {/* <!-- Cuadrado de delante --> */}
                                <rect
                                  x="4"
                                  y="8"
                                  width="12"
                                  height="12"
                                  rx="2"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                />
                              </svg>
      
                            );
                            
                            return (
                              <div className="table-wrapper">
                                {/* 3. Conectamos la función al onClick del botón. */}
                                <button className="copy-button" onClick={handleCopy}>
                                  <CopyIcon/>
                                </button>
                                {/* 4. Le ponemos la "etiqueta" a la tabla. */}
                                <table {...props} ref={tableRef} />
                              </div>
                            );
                          }
                          }}    
                          
                          >{String(msg.content)}
                      </ReactMarkdown>
                      ) : (
                    <>
                      <p>{msg.content}</p>
                      {/* Si el mensaje es largo, muestra el botón */}
                      {msg.isLong && (
                        <button className="expand-btn" onClick={() => toggleMessageExpansion(msg.id)}>
                          {msg.isExpanded ? 'Ver menos' : 'Ver más'}
                        </button>
                      )}
                    </>
                  )
                }
            </div>
          ))}
        </div>

        {/* --- NUEVO CONTENEDOR PARA EL ÁREA DE ENTRADA --- */}
        <div className="input-area-container">
          {/* El selector de estilo ya no es necesario aquí, lo moveremos */}
          <div className="chat-input-area">
            <textarea
                  ref={textareaRef}
                  placeholder="Escribe tu mensaje..."
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey){
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }
                }
            />

            <div className="input-controls">

              {/**Controles de la izquierda*/}
              <div className="controls-left">
                <div className="style-selector-wrapper">
                  <select value={style} onChange={(e) => setStyle(e.target.value)}>
                    {Object.keys(STYLE_INSTRUCTIONS).map(key => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <button onClick={() => fileInputRef.current.click()}>📎</button>
                <div className="tool-selector-wrapper">
                  <select 
                    value={tools}
                    onChange={(e) => {
                      const selectedTool = e.target.value;
                      
                      // Si el valor seleccionado NO es el placeholder...
                      if (ANALYSIS_TOOLS[selectedTool] !== 'placeholder') {
                        // 1. Actualiza el estado para mostrar la nueva selección
                        setTools(selectedTool);
                        
                        // 2. Llama a la función de análisis
                        handleAnalysis(selectedTool);
                      } else {
                        // Si el usuario intenta seleccionar "Herramientas", simplemente actualiza el estado
                        setTools(selectedTool);
                      }
                    }}
                  >
                    {Object.keys(ANALYSIS_TOOLS).map(key => (
                      <option 
                        key={key} 
                        value={key}
                        // La opción "Herramientas" estará deshabilitada para que no se pueda "re-seleccionar" si ya está activa
                        disabled={ANALYSIS_TOOLS[key] === 'placeholder'}
                      >
                        {key}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/**Controles de la derecha*/}  
              <div className="controls-right"> 
                {/* --- NUEVO BOTÓN DE MICRÓFONO --- */}
                <button title="Usar micrófono" onClick={handleMicClick}>
                    <svg 
                    xmlns="http://www.w3.org/2000/svg" width="16" height="16" 
                    fill="currentColor" className={isListening ? 'mic-listening' : ''} 
                    viewBox="0 0 16 16"><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/>
                    <path d="M8 1a2.5 2.5 0 0 0-2.5 2.5V8a2.5 2.5 0 0 0 5 0V3.5A2.5 2.5 0 0 0 8 1"/>
                    </svg>
                </button>
                
                <button onClick={handleSendMessage}>➤</button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default Chat;
