# Natural Language to Database Query Framework

A production-ready framework for converting natural language questions into database queries and generating intelligent answers.

## Technology Stack

### Core Framework
- **FastAPI** - Modern async web framework for Python
- **Uvicorn** - ASGI server with async support
- **Pydantic** - Data validation and settings management
- **Python 3.10+** - Runtime environment

### Database Layer
- **MongoDB** - NoSQL document database
- **PyMongo** - Official MongoDB driver for Python
- Native aggregation pipeline support

### AI/LLM Components
- **Google Gemini AI** (gemini-2.0-flash) - Large Language Model
  - Query generation from natural language
  - Answer generation
  - Multi-interpretation reasoning
- **google-generativeai SDK** - Python client for Gemini

### Semantic Search & Learning
- **Sentence Transformers** - Text embedding generation
  - Model: `all-MiniLM-L6-v2` (384-dimensional embeddings)
- **FAISS** - Vector similarity search
  - Fast nearest neighbor lookup
  - L2 distance metric
- **Scikit-learn** - ML utilities and metrics

### Supporting Libraries
- **python-dotenv** - Environment configuration
- **requests** - HTTP client for external APIs
- **NumPy** - Numerical operations for embeddings

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer (FastAPI)                      │
│  - REST endpoints                                                │
│  - CORS middleware                                               │
│  - Rate limiting                                                 │
│  - Global error handling                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Intent Analysis Layer                         │
│  - Question classification                                       │
│  - Context extraction                                            │
│  - Conversation memory                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
┌────────▼────────┐            ┌────────▼────────┐
│  Learning Cache │            │  Ensemble Mode  │
│  - Search for   │            │  - Generate 3+  │
│    similar      │            │    interpretations│
│    queries      │            │  - Score results│
│  - Return if    │            │  - Pick best    │
│    found        │            │                 │
└────────┬────────┘            └────────┬────────┘
         │                               │
         └───────────────┬───────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   Query Generation Layer                         │
│  - LLM prompt construction                                       │
│  - Schema injection                                              │
│  - Few-shot examples                                             │
│  - JSON query generation                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Query Fixing Layer                            │
│  - Auto-correct common mistakes                                 │
│  - Validate structure                                            │
│  - Add safety filters                                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Database Executor                             │
│  - MongoDB query execution                                       │
│  - Data type conversion                                          │
│  - Safety enforcement                                            │
│  - Timeout handling                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   Answer Building Layer                          │
│  - Result analysis                                               │
│  - Context-aware formatting                                      │
│  - Natural language generation                                   │
│  - Special case handlers                                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                      Response & Learning                         │
│  - Return formatted answer                                       │
│  - Store interaction                                             │
│  - Update learning cache                                         │
│  - Build semantic index                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Schema Definition System

**Purpose:** Teach the LLM about your database structure

**Implementation:**
```python
SCHEMA = {
    "collection_name": {
        "description": "What this collection stores (for LLM)",
        "fields": {
            "field1": {
                "type": "string",
                "description": "Detailed explanation for LLM"
            },
            "field2": {
                "type": "number", 
                "description": "What this field represents"
            },
            "nested.field": {
                "type": "object",
                "description": "Nested field explanation"
            }
        },
        "notes": "Additional context, special cases, edge cases"
    }
}
```

**Key Principles:**
- Write descriptions for the LLM, not humans
- Include data types, formats, special cases
- Explain relationships between fields
- Mention common query patterns
- Document edge cases and gotchas

### 2. Few-Shot Learning System

**Purpose:** Provide examples to guide query generation

**Implementation:**
```python
QUERY_EXAMPLES = [
    {
        "question": "Sample question in natural language",
        "collection": "target_collection",
        "operation": "find",  # or "count", "aggregate"
        "filter": {"field": {"$operator": "value"}},
        "projection": {"field1": 1, "field2": 1},
        "sort": {"field": -1},
        "limit": 10,
        "notes": "Why this query works"
    },
    # 15-20 diverse examples covering:
    # - Simple filters
    # - Date ranges
    # - Aggregations
    # - Counts
    # - Complex conditions
    # - Multi-field queries
]
```

**Best Practices:**
- Cover all common query types
- Include edge cases
- Show proper operator usage
- Demonstrate aggregation pipelines
- Add variety in complexity

### 3. LLM Prompt Engineering

**Structure:**
```
1. Role Definition
   "You are a MongoDB query generator for [domain]"

2. Schema Injection
   [Full schema with descriptions]

3. Context Variables
   - Current date/time
   - User ID
   - Conversation history
   - Previous query context

4. Few-Shot Examples
   [15-20 curated examples]

5. Rules & Constraints
   - Output format (pure JSON)
   - Operator usage
   - Collection selection logic
   - Special case handling
   - Safety requirements

6. User Question
   [The actual question]

7. Output Request
   "Generate MongoDB query JSON:"
```

**Prompt Optimization Techniques:**
- Use clear, imperative language
- Provide counter-examples (what NOT to do)
- Include CRITICAL tags for important rules
- Use markdown for readability
- Add validation rules
- Specify exact JSON structure

### 4. Query Auto-Correction Layer

**Purpose:** Fix common LLM mistakes automatically

**Common Fixes:**
```python
# Fix 1: Incorrect sum operations
# Before: {"$sum": 0}
# After: {"$sum": "$fieldName"}

# Fix 2: Wrong collection selection
# Before: collection="DeprecatedCollection"
# After: collection="ActiveCollection"

# Fix 3: Redundant filters
# Before: {"uid": "123", "city": "xyz"}  # UID is unique!
# After: {"uid": "123"}

# Fix 4: Missing safety filters
# Before: {"field": "value"}
# After: {"field": "value", "active": true}

# Fix 5: City name extraction
# Ensure city comes from question, not examples

# Fix 6: Date format conversion
# Convert ISO strings to datetime objects
```

**Implementation Pattern:**
```python
def fix_query_mistakes(query: dict, question: str) -> dict:
    query = _fix_sum_operations(query)
    query = _fix_collection_routing(query)
    query = _remove_redundant_filters(query, question)
    query = _add_safety_filters(query)
    query = _validate_city_extraction(query, question)
    return query
```

### 5. Database Safety Layer

**Purpose:** Enforce data integrity and security at DB level

**Implementation:**
```python
def execute_query(query: dict) -> list:
    collection_name = query["collection"]
    filter_query = query.get("filter", {})
    operation = query["operation"]
    
    # Safety enforcement
    filter_query = add_mandatory_filters(collection_name, filter_query)
    filter_query = convert_data_types(filter_query)
    filter_query = validate_operators(filter_query)
    
    # Execute with timeout
    result = db[collection_name].execute(
        operation, 
        filter_query,
        timeout=30
    )
    
    return result
```

**Safety Patterns:**
- Always add required filters (e.g., `active=true`, `deleted=false`)
- Convert date strings to datetime objects
- Validate operators ($regex, $in, etc.)
- Enforce query timeouts
- Sanitize user inputs
- Add execution logging

### 6. Conversation Memory System

**Purpose:** Handle follow-up questions with context

**Storage:**
```python
conversation_memory = {
    "user_id": {
        "messages": [
            {
                "role": "user",
                "content": "Question 1",
                "timestamp": datetime
            },
            {
                "role": "assistant",
                "content": "Answer 1",
                "context": {
                    "collection": "users",
                    "query": {...},
                    "result_count": 5
                }
            }
        ],
        "max_history": 5  # Keep last N exchanges
    }
}
```

**Context Injection:**
```python
def build_context_string(user_id: str) -> str:
    history = get_conversation_history(user_id)
    context = "Previous conversation:\n"
    for msg in history[-3:]:  # Last 3 exchanges
        context += f"{msg['role']}: {msg['content']}\n"
    return context
```

### 7. Self-Learning System

**Purpose:** Improve accuracy over time by learning from successful queries

**Learning Flow:**
```
Every Query → Store Interaction → Analyze Success → Cache Pattern
                                         │
                                         ▼
                              Future Similar Question
                                         │
                                         ▼
                              Search Similarity Cache
                                         │
                                         ▼
                           Found Match? → Reuse Query
                                         │
                           No Match? → Generate New
```

**Storage Schema:**
```python
interaction = {
    "timestamp": datetime,
    "question": "original question",
    "question_embedding": [384-dim vector],
    "generated_query": {...},
    "collection": "collection_name",
    "operation": "find",
    "result_count": 10,
    "user_feedback": "positive/negative/none",
    "success_score": 0.95
}
```

**Similarity Search:**
```python
def find_similar_query(question: str) -> dict:
    # Generate embedding
    embedding = model.encode(question)
    
    # FAISS similarity search
    distances, indices = faiss_index.search(embedding, k=5)
    
    # Get best match above threshold
    if distances[0] < threshold:
        return cached_queries[indices[0]]
    
    return None
```

### 8. FAISS Index Building

**Purpose:** Fast semantic search over past queries

**Index Creation:**
```python
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np

# Initialize model
model = SentenceTransformer('all-MiniLM-L6-v2')

# Get successful interactions
questions = [interaction["question"] for interaction in successful_queries]

# Generate embeddings
embeddings = model.encode(questions, show_progress_bar=True)

# Build FAISS index
dimension = embeddings.shape[1]  # 384 for MiniLM
index = faiss.IndexFlatL2(dimension)
index.add(np.array(embeddings))

# Save index
faiss.write_index(index, "faiss_index.bin")
```

**Search Usage:**
```python
# Query
question = "new question"
query_embedding = model.encode([question])

# Search top 5 similar
distances, indices = index.search(query_embedding, k=5)

# Get matches above threshold
similarity_threshold = 0.85
matches = [
    {
        "question": questions[i],
        "query": queries[i],
        "similarity": 1 - distances[0][idx]
    }
    for idx, i in enumerate(indices[0])
    if (1 - distances[0][idx]) > similarity_threshold
]
```

### 9. Ensemble Query System

**Purpose:** Generate multiple interpretations and pick the best result

**Flow:**
```python
def ensemble_query(question: str) -> dict:
    # Step 1: Generate multiple interpretations
    interpretations = [
        generate_literal_interpretation(question),
        generate_broad_interpretation(question),
        generate_time_based_interpretation(question)
    ]
    
    # Step 2: Execute all queries
    results = []
    for interpretation in interpretations:
        query = generate_query(interpretation)
        data = execute_query(query)
        score = score_result(question, query, data)
        results.append({
            "interpretation": interpretation,
            "query": query,
            "data": data,
            "score": score
        })
    
    # Step 3: Pick best result
    best = max(results, key=lambda x: x["score"])
    return best
```

**Scoring Criteria:**
```python
def score_result(question: str, query: dict, data: list) -> float:
    score = 0.0
    
    # Data presence
    if len(data) == 0:
        return 0.0
    elif 1 <= len(data) <= 10:
        score += 0.8
    elif 11 <= len(data) <= 50:
        score += 0.6
    else:
        score += 0.4
    
    # Collection relevance
    if expected_collection_in_question(question, query["collection"]):
        score += 0.15
    
    # Operation type
    if is_aggregate_query(query) and has_numeric_result(data):
        score += 0.05
    
    return min(score, 1.0)
```

### 10. Answer Building System

**Purpose:** Convert database results into natural language

**Answer Builder Pattern:**
```python
def build_answer(question: str, data: list, query: dict) -> str:
    # Step 1: Detect query type
    query_type = detect_query_type(question, query, data)
    
    # Step 2: Route to appropriate handler
    handlers = {
        "count": format_count_answer,
        "list": format_list_answer,
        "aggregate": format_aggregate_answer,
        "single_record": format_single_record,
        "date_range": format_date_range_answer,
        "comparison": format_comparison_answer
    }
    
    formatter = handlers.get(query_type, format_generic_answer)
    
    # Step 3: Generate answer
    return formatter(question, data, query)
```

**Answer Templates:**
```python
# Count template
def format_count_answer(question, data, query):
    count = data[0].get("count", len(data))
    collection = query["collection"]
    return f"Found {count} {collection} matching your criteria."

# List template
def format_list_answer(question, data, query):
    items = "\n".join([f"• {item['name']}" for item in data[:10]])
    total = len(data)
    return f"Here are {total} results:\n{items}"

# Aggregate template
def format_aggregate_answer(question, data, query):
    result = data[0]
    metric = result.get("total", result.get("average", "N/A"))
    return f"The result is: {metric}"
```

**LLM-Powered Natural Answer:**
```python
def generate_natural_answer(question: str, data: list) -> str:
    prompt = f"""
    Question: {question}
    
    Data: {json.dumps(data[:5], indent=2)}
    
    Generate a natural, helpful answer in 2-3 sentences.
    Be specific, use numbers, be conversational.
    """
    
    response = llm.generate(prompt)
    return response.text
```

---

## Best Practices

### Schema Design
- ✅ Write for the LLM, not humans
- ✅ Include examples in descriptions
- ✅ Document edge cases and special formats
- ✅ Explain relationships between collections
- ✅ Mention common query patterns

### Few-Shot Examples
- ✅ Cover 80% of real use cases
- ✅ Include edge cases and complex queries
- ✅ Show proper operator usage
- ✅ Demonstrate aggregation patterns
- ✅ Add variety in complexity levels

### Query Validation
- ✅ Validate before execution
- ✅ Auto-fix common mistakes
- ✅ Add safety filters at DB level
- ✅ Convert data types properly
- ✅ Enforce timeouts

### Learning System
- ✅ Store all interactions
- ✅ Track success metrics
- ✅ Build semantic index regularly
- ✅ Prune failed queries
- ✅ Reuse proven patterns

### Error Handling
- ✅ Graceful degradation
- ✅ Informative error messages
- ✅ Fallback mechanisms
- ✅ Logging and monitoring
- ✅ User-friendly responses

---

## Performance Optimization

### Caching Strategy
1. **Query Cache** - Store successful query patterns
2. **Embedding Cache** - Cache question embeddings
3. **Result Cache** - Cache frequent query results (with TTL)
4. **Schema Cache** - Load schema once at startup

### Database Optimization
1. **Indexes** - Create indexes on frequently queried fields
2. **Projections** - Only fetch needed fields
3. **Limits** - Always set reasonable limits
4. **Timeouts** - Prevent long-running queries

### FAISS Optimization
1. **Index Type** - Use `IndexFlatL2` for <100K vectors, `IndexIVFFlat` for larger
2. **Batch Processing** - Encode in batches
3. **Dimension Reduction** - Consider PCA if needed
4. **GPU Acceleration** - Use `faiss-gpu` for large scale

---

## Deployment Considerations

### Environment Variables
```bash
# LLM
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-2.0-flash

# Database
MONGODB_URL=mongodb://localhost:27017
DATABASE_NAME=your_db

# API
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=false

# Embeddings
EMBEDDING_MODEL=all-MiniLM-L6-v2
FAISS_INDEX_PATH=/path/to/index.bin

# Security
ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT=100/minute
```

### Production Checklist
- [ ] Enable HTTPS
- [ ] Configure CORS properly
- [ ] Add rate limiting
- [ ] Enable logging and monitoring
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Configure database connection pooling
- [ ] Add health check endpoints
- [ ] Set query timeouts
- [ ] Implement authentication
- [ ] Add input sanitization
- [ ] Configure backups
- [ ] Set up CI/CD

---

## Metrics & Monitoring

### Key Metrics
```python
metrics = {
    "query_generation": {
        "success_rate": 0.95,
        "avg_latency_ms": 250,
        "cache_hit_rate": 0.65
    },
    "database_execution": {
        "success_rate": 0.98,
        "avg_latency_ms": 150,
        "timeout_rate": 0.01
    },
    "answer_quality": {
        "user_satisfaction": 0.85,
        "follow_up_rate": 0.30
    }
}
```

### Logging Strategy
```python
log_interaction({
    "timestamp": datetime.utcnow(),
    "question": question,
    "collection_used": query["collection"],
    "operation": query["operation"],
    "execution_time_ms": elapsed,
    "result_count": len(data),
    "cache_hit": cache_hit,
    "error": None,
    "user_feedback": feedback
})
```

---

## Scaling Considerations

### Horizontal Scaling
- Load balance FastAPI instances
- Use Redis for shared cache
- Distribute FAISS index across nodes
- Implement request queuing

### Vertical Scaling
- Increase LLM rate limits
- Add more database connections
- Allocate more memory for FAISS
- Use GPU for embeddings

---

## Common Pitfalls & Solutions

| Pitfall | Solution |
|---------|----------|
| LLM generates wrong collection | Add more examples, strengthen schema descriptions |
| Queries too slow | Add indexes, use projections, limit results |
| Low cache hit rate | Improve question normalization, use semantic search |
| Poor answer quality | Add specialized formatters, improve prompts |
| High LLM costs | Implement aggressive caching, use smaller model for simple queries |
| Security vulnerabilities | Sanitize inputs, validate queries, add rate limiting |

---

## Extending the Framework

### Adding New Features

1. **New Data Type Support**
   - Update schema definitions
   - Add type-specific formatters
   - Create specialized examples
   - Add auto-correction rules

2. **New LLM Provider**
   - Abstract LLM interface
   - Implement provider-specific client
   - Update prompt templates
   - Test compatibility

3. **New Database Support**
   - Create database adapter interface
   - Implement query translation layer
   - Update schema format
   - Add database-specific optimizations

4. **Advanced Analytics**
   - Add complex aggregation templates
   - Create visualization generators
   - Implement multi-step reasoning
   - Add data exploration mode

---

## Framework Summary

**Core Philosophy:**
1. Schema-driven approach guides the LLM
2. Few-shot learning provides concrete examples
3. Auto-correction handles common mistakes
4. Multi-layer validation ensures safety
5. Self-learning improves over time
6. Context awareness enables conversations
7. Ensemble methods maximize accuracy

**Technology Choices:**
- **FastAPI** - Modern, async, well-documented
- **Gemini** - Powerful, cost-effective, JSON-friendly
- **MongoDB** - Flexible schema, powerful aggregations
- **FAISS** - Fast, scalable, production-ready
- **Sentence Transformers** - Accurate, lightweight, easy to use

**Success Factors:**
- Quality schema documentation (40% of accuracy)
- Diverse, well-crafted examples (30% of accuracy)
- Robust error handling (15% of accuracy)
- Self-learning system (10% of accuracy)
- Answer formatting (5% of accuracy)

---

## License & Credits

This framework architecture is based on production NL2SQL/NL2NoSQL patterns used across industry. Core concepts adapted from research in prompt engineering, few-shot learning, and retrieval-augmented generation (RAG).
