"""
Plagiarism Detection Core Algorithms
Based on: Broder (1997) "On the resemblance and containment of documents"
         Rajaraman & Ullman (2011) "Mining of Massive Datasets"

This module implements:
- Shingling (k-shingles/n-grams)
- MinHash signatures
- LSH (Locality-Sensitive Hashing) for fast similarity search
- Jaccard & Cosine similarity metrics
"""

import hashlib
import random
import json
import sqlite3
import os
import re
from collections import defaultdict
from typing import List, Set, Dict, Tuple, Optional
from pathlib import Path

# =============================================================================
# DATABASE SETUP
# =============================================================================

DB_PATH = "data/plagiarism.db"

def init_database():
    """Initialize SQLite database with required tables"""
    os.makedirs("data", exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Documents table - stores original documents
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            filename TEXT,
            content TEXT NOT NULL,
            word_count INTEGER,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            category TEXT DEFAULT 'uncategorized'
        )
    """)
    
    # Fingerprints table - stores MinHash signatures
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fingerprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            signature TEXT NOT NULL,
            num_shingles INTEGER,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
    """)
    
    # LSH Buckets table - for fast similarity search
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lsh_buckets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            band_id INTEGER NOT NULL,
            bucket_hash TEXT NOT NULL,
            document_id INTEGER NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
    """)
    
    # Comparison results cache
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS comparison_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_document_id INTEGER,
            compared_document_id INTEGER NOT NULL,
            similarity_score REAL NOT NULL,
            matching_shingles TEXT,
            comparison_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (compared_document_id) REFERENCES documents(id)
        )
    """)
    
    # Create indexes for fast lookups
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_lsh_bucket ON lsh_buckets(band_id, bucket_hash)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_fingerprints_doc ON fingerprints(document_id)")
    
    conn.commit()
    conn.close()
    print("✅ Database initialized successfully at", DB_PATH)

# =============================================================================
# TEXT PREPROCESSING
# =============================================================================

def preprocess_text(text: str) -> str:
    """
    Normalize text for consistent comparison:
    - Lowercase
    - Remove extra whitespace
    - Remove punctuation (optional, configurable)
    - Remove common stopwords (for better comparison)
    """
    # Convert to lowercase
    text = text.lower()
    
    # Remove special characters, keep only letters, numbers, spaces
    text = re.sub(r'[^\w\s]', ' ', text)
    
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

# =============================================================================
# SHINGLING (k-grams)
# =============================================================================

def create_shingles(text: str, k: int = 5) -> Set[str]:
    """
    Create k-shingles (character n-grams) from text.
    
    According to Broder (1997), k=5-9 works well for documents.
    For short documents, k=5 is recommended.
    
    Args:
        text: Preprocessed text
        k: Shingle size (default 5)
    
    Returns:
        Set of k-shingles
    """
    text = preprocess_text(text)
    
    if len(text) < k:
        return {text}
    
    shingles = set()
    for i in range(len(text) - k + 1):
        shingle = text[i:i + k]
        shingles.add(shingle)
    
    return shingles


def create_word_shingles(text: str, k: int = 3) -> Set[str]:
    """
    Create word-based shingles (word n-grams).
    Better for detecting paraphrasing.
    
    Args:
        text: Preprocessed text
        k: Number of words per shingle
    
    Returns:
        Set of word shingles
    """
    text = preprocess_text(text)
    words = text.split()
    
    if len(words) < k:
        return {' '.join(words)}
    
    shingles = set()
    for i in range(len(words) - k + 1):
        shingle = ' '.join(words[i:i + k])
        shingles.add(shingle)
    
    return shingles

# =============================================================================
# MINHASH SIGNATURES
# =============================================================================

class MinHash:
    """
    MinHash implementation for estimating Jaccard similarity.
    
    Based on Broder (1997) and the principle that:
    Pr[h(A) = h(B)] = |A ∩ B| / |A ∪ B| = Jaccard(A, B)
    """
    
    def __init__(self, num_hashes: int = 128, seed: int = 42):
        """
        Initialize MinHash with random hash functions.
        
        Args:
            num_hashes: Number of hash functions (signature size)
            seed: Random seed for reproducibility
        """
        self.num_hashes = num_hashes
        self.seed = seed
        
        # Generate hash function parameters
        # h(x) = (a * x + b) mod p
        random.seed(seed)
        self.max_hash = 2**32 - 1
        self.prime = 4294967311  # Large prime > max_hash
        
        self.hash_params = [
            (random.randint(1, self.max_hash), random.randint(0, self.max_hash))
            for _ in range(num_hashes)
        ]
    
    def _hash_shingle(self, shingle: str) -> int:
        """Convert shingle to integer hash"""
        return int(hashlib.md5(shingle.encode('utf-8')).hexdigest(), 16) % self.max_hash
    
    def compute_signature(self, shingles: Set[str]) -> List[int]:
        """
        Compute MinHash signature for a set of shingles.
        
        Args:
            shingles: Set of shingles
        
        Returns:
            MinHash signature (list of minimum hash values)
        """
        if not shingles:
            return [self.max_hash] * self.num_hashes
        
        signature = [self.max_hash] * self.num_hashes
        
        for shingle in shingles:
            shingle_hash = self._hash_shingle(shingle)
            
            for i, (a, b) in enumerate(self.hash_params):
                # Compute hash value
                hash_value = (a * shingle_hash + b) % self.prime
                # Keep minimum
                signature[i] = min(signature[i], hash_value)
        
        return signature
    
    def estimate_similarity(self, sig1: List[int], sig2: List[int]) -> float:
        """
        Estimate Jaccard similarity from MinHash signatures.
        
        Args:
            sig1, sig2: MinHash signatures
        
        Returns:
            Estimated Jaccard similarity
        """
        if len(sig1) != len(sig2):
            raise ValueError("Signatures must have same length")
        
        matches = sum(1 for s1, s2 in zip(sig1, sig2) if s1 == s2)
        return matches / len(sig1)

# =============================================================================
# LSH (Locality-Sensitive Hashing)
# =============================================================================

class LSH:
    """
    Locality-Sensitive Hashing for fast approximate nearest neighbor search.
    
    Divides MinHash signature into bands, documents that share at least
    one band are considered candidate pairs.
    
    Probability of becoming a candidate:
    P = 1 - (1 - s^r)^b
    where s = similarity, r = rows per band, b = number of bands
    """
    
    def __init__(self, num_bands: int = 16, rows_per_band: int = 8):
        """
        Initialize LSH index.
        
        Args:
            num_bands: Number of bands (b)
            rows_per_band: Rows per band (r)
            
        Note: num_bands * rows_per_band should equal MinHash signature size
        """
        self.num_bands = num_bands
        self.rows_per_band = rows_per_band
        self.buckets: Dict[int, Dict[str, Set[int]]] = defaultdict(lambda: defaultdict(set))
    
    def _hash_band(self, band: List[int]) -> str:
        """Create hash for a band of signature values"""
        band_str = ','.join(map(str, band))
        return hashlib.md5(band_str.encode()).hexdigest()
    
    def index_signature(self, doc_id: int, signature: List[int]):
        """
        Add a document's signature to the LSH index.
        
        Args:
            doc_id: Document identifier
            signature: MinHash signature
        """
        for band_id in range(self.num_bands):
            start = band_id * self.rows_per_band
            end = start + self.rows_per_band
            band = signature[start:end]
            
            bucket_hash = self._hash_band(band)
            self.buckets[band_id][bucket_hash].add(doc_id)
    
    def find_candidates(self, signature: List[int]) -> Set[int]:
        """
        Find candidate documents that may be similar.
        
        Args:
            signature: Query MinHash signature
        
        Returns:
            Set of candidate document IDs
        """
        candidates = set()
        
        for band_id in range(self.num_bands):
            start = band_id * self.rows_per_band
            end = start + self.rows_per_band
            band = signature[start:end]
            
            bucket_hash = self._hash_band(band)
            candidates.update(self.buckets[band_id].get(bucket_hash, set()))
        
        return candidates
    
    def save_to_db(self, doc_id: int, signature: List[int]):
        """Save LSH buckets to database for persistence"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        for band_id in range(self.num_bands):
            start = band_id * self.rows_per_band
            end = start + self.rows_per_band
            band = signature[start:end]
            bucket_hash = self._hash_band(band)
            
            cursor.execute(
                "INSERT INTO lsh_buckets (band_id, bucket_hash, document_id) VALUES (?, ?, ?)",
                (band_id, bucket_hash, doc_id)
            )
        
        conn.commit()
        conn.close()
    
    def load_from_db(self):
        """Load LSH index from database"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("SELECT band_id, bucket_hash, document_id FROM lsh_buckets")
        
        for band_id, bucket_hash, doc_id in cursor.fetchall():
            self.buckets[band_id][bucket_hash].add(doc_id)
        
        conn.close()

# =============================================================================
# SIMILARITY METRICS
# =============================================================================

def jaccard_similarity(set1: Set[str], set2: Set[str]) -> float:
    """
    Compute exact Jaccard similarity between two sets.
    
    J(A, B) = |A ∩ B| / |A ∪ B|
    """
    if not set1 or not set2:
        return 0.0
    
    intersection = len(set1 & set2)
    union = len(set1 | set2)
    
    return intersection / union if union > 0 else 0.0


def cosine_similarity(set1: Set[str], set2: Set[str]) -> float:
    """
    Compute Cosine similarity treating sets as binary vectors.
    
    cos(A, B) = |A ∩ B| / (sqrt(|A|) * sqrt(|B|))
    """
    if not set1 or not set2:
        return 0.0
    
    intersection = len(set1 & set2)
    
    return intersection / (len(set1) ** 0.5 * len(set2) ** 0.5)


def find_matching_fragments(text1: str, text2: str, min_length: int = 30) -> List[Dict]:
    """
    Find matching text fragments between two documents.
    
    Args:
        text1, text2: Document texts
        min_length: Minimum fragment length to report
    
    Returns:
        List of matching fragments with positions
    """
    matches = []
    
    # Use word-based approach for meaningful matches
    words1 = preprocess_text(text1).split()
    words2 = preprocess_text(text2).split()
    
    # Find longest common subsequences
    window_size = 5  # Minimum words to consider a match
    
    for i in range(len(words1) - window_size + 1):
        window = ' '.join(words1[i:i + window_size])
        text2_processed = ' '.join(words2)
        
        if window in text2_processed:
            # Expand match
            match_start = i
            match_end = i + window_size
            
            # Try to extend the match
            while match_end < len(words1):
                extended = ' '.join(words1[match_start:match_end + 1])
                if extended in text2_processed:
                    match_end += 1
                else:
                    break
            
            matched_text = ' '.join(words1[match_start:match_end])
            
            if len(matched_text) >= min_length:
                # Find position in original text (approximate)
                pos_in_text2 = text2_processed.find(matched_text)
                
                matches.append({
                    'text': matched_text,
                    'position_doc1': match_start,
                    'position_doc2': pos_in_text2,
                    'length': len(matched_text.split())
                })
    
    # Remove overlapping matches, keep longest
    matches.sort(key=lambda x: x['length'], reverse=True)
    filtered = []
    used_positions = set()
    
    for match in matches:
        pos = match['position_doc1']
        if pos not in used_positions:
            filtered.append(match)
            for p in range(pos, pos + match['length']):
                used_positions.add(p)
    
    return filtered

# =============================================================================
# MAIN PLAGIARISM CHECKER
# =============================================================================

class PlagiarismChecker:
    """
    Main class that orchestrates plagiarism detection.
    """
    
    def __init__(self, shingle_size: int = 5, num_hashes: int = 128, 
                 num_bands: int = 16, rows_per_band: int = 8):
        """
        Initialize the plagiarism checker.
        
        Default parameters tuned for:
        - ~50% similarity threshold
        - Good balance of precision/recall
        """
        self.shingle_size = shingle_size
        self.minhash = MinHash(num_hashes=num_hashes)
        self.lsh = LSH(num_bands=num_bands, rows_per_band=rows_per_band)
        
        # Load existing LSH index
        init_database()
        self.lsh.load_from_db()
    
    def add_document(self, title: str, content: str, author: str = None, 
                     filename: str = None, category: str = "uncategorized") -> int:
        """
        Add a document to the database and index it.
        
        Returns:
            Document ID
        """
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Store document
        word_count = len(content.split())
        cursor.execute(
            """INSERT INTO documents (title, author, filename, content, word_count, category)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (title, author, filename, content, word_count, category)
        )
        doc_id = cursor.lastrowid
        
        # Create shingles and signature
        shingles = create_shingles(content, k=self.shingle_size)
        signature = self.minhash.compute_signature(shingles)
        
        # Store fingerprint
        cursor.execute(
            "INSERT INTO fingerprints (document_id, signature, num_shingles) VALUES (?, ?, ?)",
            (doc_id, json.dumps(signature), len(shingles))
        )
        
        conn.commit()
        conn.close()
        
        # Index in LSH
        self.lsh.index_signature(doc_id, signature)
        self.lsh.save_to_db(doc_id, signature)
        
        return doc_id
    
    def check_document(self, content: str, top_k: int = 5) -> Dict:
        """
        Check a document against the database.
        
        Args:
            content: Document text to check
            top_k: Number of most similar documents to return
        
        Returns:
            Detection results with similarity scores and matches
        """
        # Create signature for query document
        shingles = create_shingles(content, k=self.shingle_size)
        signature = self.minhash.compute_signature(shingles)
        
        # Find candidates using LSH
        candidates = self.lsh.find_candidates(signature)
        
        if not candidates:
            return {
                'uniqueness_score': 100.0,
                'total_documents_checked': self._get_document_count(),
                'similar_documents': [],
                'matching_fragments': []
            }
        
        # Compute exact similarities for candidates
        results = []
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        for doc_id in candidates:
            cursor.execute(
                """SELECT d.id, d.title, d.author, d.content, f.signature 
                   FROM documents d 
                   JOIN fingerprints f ON d.id = f.document_id 
                   WHERE d.id = ?""",
                (doc_id,)
            )
            row = cursor.fetchone()
            
            if row:
                doc_id, title, author, doc_content, sig_json = row
                stored_signature = json.loads(sig_json)
                
                # Estimate similarity from signatures
                similarity = self.minhash.estimate_similarity(signature, stored_signature)
                
                # For high similarity, compute exact Jaccard
                if similarity > 0.3:
                    doc_shingles = create_shingles(doc_content, k=self.shingle_size)
                    exact_similarity = jaccard_similarity(shingles, doc_shingles)
                    
                    # Find matching fragments
                    fragments = find_matching_fragments(content, doc_content)
                    
                    results.append({
                        'document_id': doc_id,
                        'title': title,
                        'author': author,
                        'similarity': round(exact_similarity * 100, 2),
                        'matching_fragments': fragments[:5]  # Top 5 fragments
                    })
        
        conn.close()
        
        # Sort by similarity
        results.sort(key=lambda x: x['similarity'], reverse=True)
        top_results = results[:top_k]
        
        # Calculate overall uniqueness
        max_similarity = top_results[0]['similarity'] if top_results else 0
        uniqueness = round(100 - max_similarity, 2)
        
        return {
            'uniqueness_score': uniqueness,
            'total_documents_checked': self._get_document_count(),
            'candidates_found': len(candidates),
            'similar_documents': top_results,
            'matching_fragments': top_results[0]['matching_fragments'] if top_results else []
        }
    
    def _get_document_count(self) -> int:
        """Get total number of documents in database"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM documents")
        count = cursor.fetchone()[0]
        conn.close()
        return count
    
    def get_all_documents(self) -> List[Dict]:
        """Get all documents from database"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, title, author, filename, word_count, upload_date, category 
               FROM documents ORDER BY upload_date DESC"""
        )
        
        documents = []
        for row in cursor.fetchall():
            documents.append({
                'id': row[0],
                'title': row[1],
                'author': row[2],
                'filename': row[3],
                'word_count': row[4],
                'upload_date': row[5],
                'category': row[6]
            })
        
        conn.close()
        return documents
    
    def delete_document(self, doc_id: int) -> bool:
        """Delete a document from the database"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM lsh_buckets WHERE document_id = ?", (doc_id,))
        cursor.execute("DELETE FROM fingerprints WHERE document_id = ?", (doc_id,))
        cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        
        conn.commit()
        deleted = cursor.rowcount > 0
        conn.close()
        
        return deleted


# =============================================================================
# CLI INTERFACE FOR TESTING
# =============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("🔬 Plagiarism Detection System - Core Algorithms Test")
    print("=" * 60)
    
    # Initialize
    checker = PlagiarismChecker()
    
    # Add sample documents
    sample_docs = [
        {
            "title": "Introduction to Machine Learning",
            "author": "Student A",
            "content": """Machine learning is a subset of artificial intelligence that 
            enables systems to learn and improve from experience without being explicitly 
            programmed. Machine learning algorithms use historical data as input to predict 
            new output values. Recommendation engines are a common use case for machine learning."""
        },
        {
            "title": "AI Fundamentals",
            "author": "Student B", 
            "content": """Artificial intelligence encompasses machine learning and deep learning.
            Machine learning allows systems to automatically learn from data and improve their
            performance over time. Deep learning uses neural networks with many layers."""
        },
        {
            "title": "Database Systems",
            "author": "Student C",
            "content": """A database is an organized collection of structured information stored
            electronically. Database management systems provide tools to create, read, update
            and delete data efficiently. SQL is the standard language for relational databases."""
        }
    ]
    
    print("\n📚 Adding sample documents to database...")
    for doc in sample_docs:
        doc_id = checker.add_document(
            title=doc["title"],
            content=doc["content"],
            author=doc["author"]
        )
        print(f"  ✓ Added: '{doc['title']}' (ID: {doc_id})")
    
    # Test plagiarism check
    test_text = """Machine learning is a subset of artificial intelligence that 
    enables systems to learn and improve from experience. ML algorithms use 
    historical data to predict new values."""
    
    print("\n🔍 Checking test document for plagiarism...")
    print(f"   Text: '{test_text[:80]}...'")
    
    results = checker.check_document(test_text)
    
    print(f"\n📊 Results:")
    print(f"   Uniqueness Score: {results['uniqueness_score']}%")
    print(f"   Documents in Database: {results['total_documents_checked']}")
    print(f"   Candidates Found: {results.get('candidates_found', 0)}")
    
    if results['similar_documents']:
        print(f"\n   🔴 Similar Documents Found:")
        for doc in results['similar_documents']:
            print(f"      - '{doc['title']}' by {doc['author']}: {doc['similarity']}% similar")
    else:
        print(f"\n   ✅ No similar documents found!")
    
    print("\n" + "=" * 60)
    print("✅ Core algorithms test completed!")
