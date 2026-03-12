# FUNCIONANDO BIEN HASTA AQUÍ TODA LA LÓGICA, TEMA, GRADO, SISTEMA DE INSTRUCCIONES,
# TEMPLATES, CONVERSACIÓN, MEMORIA
# --- LIBRERÍAS ---
import os
import tempfile
import uuid #Generar IDs únicos
from typing import Dict, Any #Tipado

from dotenv import load_dotenv

#import google.generativeai as genai
#from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langchain_openai import OpenAIEmbeddings

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from atemplates import SYSTEM_TEMPLATES
from functools import lru_cache

# LANGCHAIN
from langchain.prompts import ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate
from langchain.memory import ConversationBufferMemory
from langchain.chains import ConversationChain, LLMChain
from langchain.agents import Tool, initialize_agent, AgentType

# --- Imports de LangChain para RAG ---
from langchain.chains import ConversationalRetrievalChain
from langchain_community.document_loaders import PyPDFLoader, TextLoader # Añade más si los necesitas (CSVLoader, etc.)
from langchain.text_splitter import RecursiveCharacterTextSplitter
#from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import Chroma


load_dotenv()
# Creamos una instancia de la aplicación
app = FastAPI()

# --- CONFIGURACIÓN DE CORS ---
# Esto le dice a nuestro backend que permita las peticiones
# que vienen desde nuestro frontend de React en el puerto 5173.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Orígenes permitidos (tu frontend)
    allow_credentials=True,
    allow_methods=["*"], # Métodos permitidos (GET, POST, etc.)
    allow_headers=["*"], # Cabeceras permitidas
)

# --- ALMACÉN DE SESIONES ---
# Este diccionario global guardará los datos de cada conversación.
SESSIONS: Dict[str, Dict[str, Any]] = {}

# ESTILO DE INSTRUCCIONES
STYLE_INSTRUCTIONS = {
    "Normal": """Responde de manera equilibrada con suficiente detalle para ser claro pero sin ser
    excesivamente largo.
    """,
    "Conciso": """Responde de manera directa y breve. Responde en solo 1 línea. Usa frases cortas. Elimina información
    redundante.
    """,
    "Explicativo": """Proporciona explicaciones detalladas. Incluye ejemplos cuando sea útil.
    Desarrolla el contexto necesario.
    """,
    "Formal": """Usa un tono profesional y estructurado. Emplea terminología precisa. Organiza 
    la información de manera clara y sistemática. Evita coloquialismos."""
}

ANALYSIS_TOOLS = {
    "Resumen": """
    Analiza el siguiente historial de conversación entre un Estudiante y un Asistente. 
    Luego, genera un resumen en viñetas conciso y claro para un docente.
    
    HISTORIAL:
    ---
    {chat_history}
    ---
    
    RESUMEN GENERADO:
    """,
    "Progreso": """
    Como docente experto, analiza el progreso del estudiante durante toda su interacción con el chatbot.  
    - Identifica temas abordados, nivel de profundidad, errores frecuentes y mejora. Genera el informe en
    checks.
    
    HISTORIAL:
    ---
    {chat_history}
    ---
    
    PROGRESO GENERADO
    """,
    "Competencias":"",
    "Riesgo":"",
    "Sugerencias": "",
    "Mapa de Temas": "",
    "Recomendación de recursos": ""
    
}

# main.py
# ...


def get_or_create_session(session_id: str) -> Dict[str, Any]:
    """
    Actualizado para incluir campos necesarios para RAG.
    """
    if session_id not in SESSIONS:
        print(f"✨ Creando nueva sesión para session_id: {session_id}")
        SESSIONS[session_id] = {
            "messages": [],
            "memory": ConversationBufferMemory(memory_key="chat_history", return_messages=True),
            # --- ¡NUEVOS CAMPOS PARA RAG! ---
            "qa_chain": None,          # Aquí guardaremos la cadena de QA si se sube un archivo
            "indexed_names": set(),    # Para no procesar el mismo archivo dos veces
            "all_docs": []             # Para almacenar los documentos cargados
        }
    return SESSIONS[session_id]


# --Definimos la estructura
class AnalysisRequest(BaseModel):
    session_id: str
    analysis_type: str # Ej: "Resumen", "Competencias"

# 2. Define la estructura de la respuesta del análisis
class AnalysisResponse(BaseModel):
    analysis_result: str

# CHAT: Definimos la estructura
class ChatRequest(BaseModel):
    session_id: str
    user_message: str
    #Nuevos campos
    # Valores por defecto
    tema: str = "Cultura General"
    grado: str = "5° de secundaria"
    style: str = "Normal"
    
# respuesta del chat
class ChatResponse(BaseModel):
    ai_response: str

# Endpoint principal de conversación
# Endpoint principal de conversación
# =================================================================
# ======== ENDPOINT DE CHAT PRINCIPAL (VERSIÓN CORREGIDA) =========
# =================================================================
@app.post("/chat", response_model=ChatResponse)
async def handle_chat(request: ChatRequest):
    session = get_or_create_session(request.session_id)
    memory = session["memory"]

    # --- 1. PREPARAMOS LAS HERRAMIENTAS (TOOLS) ---
    
    # Herramienta de Conversación General (sin cambios)
    system_template_raw = SYSTEM_TEMPLATES.get(request.tema, SYSTEM_TEMPLATES["Cultura General"])
    system_template = system_template_raw.format(tema=request.tema, grado=request.grado)
    style_instruction = STYLE_INSTRUCTIONS.get(request.style, STYLE_INSTRUCTIONS["Normal"])
    
    human_template = "Usuario: {{input}}"

    prompt = ChatPromptTemplate.from_messages([
        SystemMessagePromptTemplate.from_template(system_template),
        HumanMessagePromptTemplate.from_template(human_template),
    ])

    llm_chain = LLMChain(llm=llm, prompt=prompt, verbose=False)

    # Nueva función híbrida
    def hybrid_tool(query: str):
        responses = []
        
        # Consultar documentos si existen
        if session.get("qa_chain"):
            try:
                chat_history_tuples = []
                messages = memory.chat_memory.messages
                for i in range(0, len(messages), 2):
                    if (i + 1) < len(messages):
                        chat_history_tuples.append((messages[i].content, messages[i+1].content))
                
                rag_result = session["qa_chain"].invoke({
                    "question": query,
                    "chat_history": chat_history_tuples
                })
                
                # Verificar si RAG tiene información útil
                rag_answer = rag_result["answer"]
                no_info_phrases = ["no encuentro", "no tengo", "don't know", "no sé", "no está", "no hay información"]

                if rag_answer and not any(phrase in rag_answer.lower() for phrase in no_info_phrases):
                    responses.append(f"Según documentos: {rag_answer}")
            except:
                pass
        
        # Siempre consultar conocimiento general
        general_result = llm_chain.invoke({"input": query})["text"]
        responses.append(f"Conocimiento general: {general_result}")
        
        # Combinar respuestas
        if len(responses) == 2:
            doc_response = responses[0].replace("Según documentos: ", "")
            general_response = responses[1].replace("Conocimiento general: ", "")
            return f"{doc_response}\n\nAdemás: {general_response}"
        else:
            # Solo conocimiento general si no hay info en documentos
            return responses[0].replace("Conocimiento general: ", "")

    tools = [
        Tool(
            name="Consultor_Inteligente",
            func=hybrid_tool,
            description="Responde cualquier pregunta usando tanto documentos como conocimiento general."
        )
    ]
    
    

    # Herramienta de Documentos (si existe la qa_chain)
    qa_chain = session.get("qa_chain")
    if qa_chain:
        def run_rag_tool(query: str):
            """Esta función es lo que la herramienta RAG ejecutará."""
            # Obtenemos el historial de la memoria principal del agente.
            chat_history_tuples = []
            messages = memory.chat_memory.messages
            for i in range(0, len(messages), 2):
                if (i + 1) < len(messages):
                    chat_history_tuples.append(
                        (messages[i].content, messages[i+1].content)
                    )
            
            # Invocamos la cadena RAG exactamente como en nuestra prueba exitosa.
            result = qa_chain.invoke({
                "question": query,
                "chat_history": chat_history_tuples
            })
            return result["answer"]

        tools.append(
            Tool(
                name="Busqueda en Documentos",
                func=run_rag_tool,
                description=(
                    "Útil para cuando necesitas responder preguntas sobre el contenido de archivos específicos que el usuario ha subido. "
                    "Usa esta herramienta si la pregunta menciona 'el archivo', 'el documento', 'el texto cargado', o si parece requerir información de un contexto previamente cargado."
                )
            )
        )

    # --- 2. INICIALIZAMOS EL AGENTE (ÉL CONTROLA LA MEMORIA) ---
    agent = initialize_agent(
        tools=tools,
        llm=llm,
        agent=AgentType.CONVERSATIONAL_REACT_DESCRIPTION,
        memory=memory, # ¡El Agente es el único que recibe la memoria!
        verbose=True,
        handle_parsing_errors=True,
        # Añadimos una instrucción para que el Agente piense mejor
        agent_kwargs={
            "system_message": "Eres un asistente servicial. Responde las preguntas del usuario. Tienes acceso a herramientas para ayudarte."
        }
    )

    # --- 3. EJECUTAMOS EL AGENTE ---
    ai_response_text = agent.run(request.user_message)

    return ChatResponse(ai_response=ai_response_text)



# @app.post("/test_rag_chat", response_model=ChatResponse)
# async def handle_rag_test(request: ChatRequest):
#     """
#     Este endpoint es SOLO para probar la cadena de RAG de forma aislada.
#     VERSIÓN 2: La cadena no gestiona la memoria, nosotros lo hacemos manualmente.
#     """
#     print("\n--- INICIANDO PRUEBA v2 EN /test_rag_chat ---")
#     session = get_or_create_session(request.session_id)
#     qa_chain = session.get("qa_chain")

#     if not qa_chain:
#         print("❌ ERROR: No se ha encontrado la 'qa_chain'. ¿Subiste un archivo primero?")
#         raise HTTPException(
#             status_code=400, 
#             detail="No hay ningún archivo procesado en esta sesión. Por favor, sube un archivo primero."
#         )

#     # 1. Preparamos el historial de chat para la cadena.
#     memory = session["memory"]
#     chat_history_tuples = []
#     messages = memory.chat_memory.messages
#     for i in range(0, len(messages), 2):
#         if (i + 1) < len(messages):
#             chat_history_tuples.append(
#                 (messages[i].content, messages[i+1].content)
#             )

#     # 2. Hacemos la pregunta. Ahora la cadena es más simple.
#     print(f"Preguntando a la cadena RAG: '{request.user_message}'")
#     result = qa_chain.invoke({
#         "question": request.user_message,
#         "chat_history": chat_history_tuples
#     })
    
#     ai_response_text = result["answer"]
#     print(f"Respuesta de la cadena RAG: '{ai_response_text}'")

#     # 3. ¡NUEVO! Guardamos manualmente la conversación en la memoria.
#     memory.save_context(
#         {"input": request.user_message},
#         {"output": ai_response_text}
#     )
#     print("✅ Conversación guardada manualmente en la memoria.")

#     print("--- FIN DE LA PRUEBA v2 ---")
#     return ChatResponse(ai_response=ai_response_text)

#=========================================


@app.post("/new_chat")
async def new_chat_endpoint():
    """
    Genera un nuevo ID de sesión único, crea la sesión en el backend
    y devuelve el ID al frontend.
    """
    session_id = str(uuid.uuid4())
    get_or_create_session(session_id) # Esto inicializa la sesión en nuestro diccionario SESSIONS
    print(f"🚀 Nuevo chat iniciado. Session ID: {session_id}")
    return {"session_id": session_id}

@app.post("/upload")
async def handle_upload(session_id: str = Form(...), files: list[UploadFile] = File(...)):
    """
    Endpoint para subir y procesar archivos para RAG.
    """
    session = get_or_create_session(session_id)
    processed_files_info = []

    # Inicializar embeddings una sola vez si es necesario
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

    for uploaded_file in files:
        if uploaded_file.filename in session["indexed_names"]:
            print(f"Archivo '{uploaded_file.filename}' ya indexado, saltando.")
            continue
        
        # Guardar el archivo temporalmente en disco para que los loaders de LangChain puedan leerlo
        with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{uploaded_file.filename}") as tmp:
            content = await uploaded_file.read()
            tmp.write(content)
            tmp_path = tmp.name

        try:
            # Seleccionar el loader según la extensión del archivo
            if uploaded_file.filename.lower().endswith(".pdf"):
                loader = PyPDFLoader(tmp_path)
            elif uploaded_file.filename.lower().endswith(".txt"):
                loader = TextLoader(tmp_path, encoding="utf-8")
            else:
                # Si el formato no es soportado, lo saltamos y limpiamos
                os.unlink(tmp_path)
                print(f"Formato de archivo no soportado: {uploaded_file.filename}")
                continue

            # Cargar y añadir documentos a la sesión
            docs = loader.load()
            session["all_docs"].extend(docs)
            
            # Marcar como indexado
            session["indexed_names"].add(uploaded_file.filename)
            processed_files_info.append(f"'{uploaded_file.filename}' cargado ({len(docs)} pág/s).")

        finally:
            # Asegurarse de borrar el archivo temporal
            os.unlink(tmp_path)

    # Si se procesaron nuevos archivos, (re)construimos el vectorstore y la cadena de QA
    if processed_files_info and session["all_docs"]:
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
        chunks = text_splitter.split_documents(session["all_docs"])
        
        print(f"Creando vectorstore con {len(chunks)} chunks...")
        vectordb = Chroma.from_documents(chunks, embeddings)
        
        # Usamos el LLM como un "condensador de preguntas" y para la respuesta final
        retriever = vectordb.as_retriever(search_kwargs={"k": 3})

        # Usamos un LLM ligero aquí (ver Paso 2) — por ahora lo dejamos como llm.
        session["qa_chain"] = ConversationalRetrievalChain.from_llm(
            llm=llm,  # en Paso 2 lo cambiamos para usar el planner
            retriever=retriever,
            return_source_documents=False,  # importante para acelerar
            verbose=False,
        )
        
        # AÑADE ESTA LÍNEA JUSTO DEBAJO PARA VERIFICAR:
        print("✅ ¡CÓDIGO NUEVO! La 'qa_chain' se ha creado con el 'output_key'.")
        
        print("Cadena de QA creada y guardada en la sesión.")
        
    
    if not processed_files_info:
        raise HTTPException(status_code=304, detail="No se procesaron archivos nuevos.")

    return {"status": "success", "processed_files": processed_files_info}


# Esqueleto del Endpoint
@app.post("/analyze_chat", response_model=AnalysisResponse)
async def handle_analysis(request: AnalysisRequest):
    # --- REEMPLAZA EL CONTENIDO DE LA FUNCIÓN CON ESTO ---
    
    # 1. Obtener la sesión y la memoria
    session = get_or_create_session(request.session_id)
    memory = session["memory"]

    # 2. Validar el tipo de análisis
    if request.analysis_type not in ANALYSIS_TOOLS:
        raise HTTPException(status_code=400, detail="Tipo de análisis no válido.")

    # 3. Formatear el historial del chat
    chat_history_list = memory.chat_memory.messages
    if not chat_history_list:
        return AnalysisResponse(analysis_result="No hay historial en esta conversación para analizar.")

    # Convierte la lista de mensajes de LangChain en un string simple
    formatted_history = "\n".join(
        [f"{'Estudiante' if msg.type == 'human' else 'Asistente'}: {msg.content}" for msg in chat_history_list]
    )

    # 4. Preparar y ejecutar la llamada al LLM
    prompt_template = ANALYSIS_TOOLS[request.analysis_type]
    final_prompt_text = prompt_template.format(chat_history=formatted_history)
    
    try:
        # Usamos el LLM directamente para esta tarea específica
        llm = get_llm()
        # El modelo espera una lista de mensajes, así que lo envolvemos
        from langchain.schema.messages import HumanMessage
        ai_response = await llm.ainvoke([HumanMessage(content=final_prompt_text)])
        analysis_result_text = ai_response.content

    except Exception as e:
        print(f"Error durante el análisis del LLM: {e}")
        raise HTTPException(status_code=500, detail="Error al procesar el análisis con el modelo de lenguaje.")

    # 5. Formatear la respuesta final que se mostrará en el chat
    final_response_content = f"**Análisis de '{request.analysis_type}'**: \n\n{analysis_result_text}"

    return AnalysisResponse(analysis_result=final_response_content)


class ChatOpenAIClean(ChatOpenAI):
    def _generate(self, messages, stop=None, **kwargs):
        # Si el modelo es gpt-5-mini, quitamos 'stop'
        if self.model_name.startswith("gpt-5-mini"):
            stop = None
        return super()._generate(messages, stop=stop, **kwargs)

# LLM
@lru_cache()
def get_llm():
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        # En una API, en lugar de st.error, lanzamos una excepción.
        raise ValueError("La OPENAI_API_KEY no se encontró en el entorno.")
    
    llm = ChatOpenAIClean(
        api_key=openai_key, # Pasa la clave directamente si quieres, aunque LangChain la lee sola del .env
        model="gpt-5-mini"#, # <--- 3. CAMBIO DE MODELO
        #temperature=0
    )
    return llm
# Esto es mucho más eficiente que crearlo en cada petición.
llm = get_llm()

@app.get("/")
def read_root():
    model_name = llm.model_name
    return {"message": "Hola mundo, aprendiendo FastAPI...",
            "llm_status": f"Modelo {model_name} inicializado correctamente"}
