import sys
import os

# Ensure we can import modules from the current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import rag
import xai
import security

def test_rag_retrieval():
    print("--- Testing RAG Retrieval Accuracy ---")
    # The corpus starts EMPTY by design, so first ingest a document, then retrieve.
    import tempfile
    sample = (
        "Basel III capital adequacy requirements stipulate that banks must maintain "
        "a minimum Common Equity Tier 1 (CET1) ratio of 4.5% of risk-weighted assets, "
        "plus a 2.5% conservation buffer for a 7.0% total."
    )
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as tmp:
        tmp.write(sample)
        tmp_path = tmp.name
    try:
        rag.ingest_document(tmp_path, "Basel_III_Capital_test.txt", replace_existing=True)
        query = "What is the minimum Common Equity Tier 1 CET1 ratio?"
        results = rag.search_documents(query, limit=2)
        print(f"Query: '{query}' -> {len(results)} results")
        assert len(results) > 0, "No results returned after ingestion."
        assert any("Basel_III_Capital_test.txt" == r["filename"] for r in results), \
            "Failed to retrieve the ingested Basel III document."
        print("SUCCESS: RAG retrieval verified.")
        print()
    finally:
        os.unlink(tmp_path)

def test_xai_attribution():
    print("--- Testing XAI Attribution Engine ---")
    scan_text = "The bank has a CET1 ratio of 5.5% on its SWIFT gateway."
    results = rag.search_documents(scan_text, limit=2)
    
    attributions = xai.calculate_local_attribution(scan_text, results)
    print(f"Scan Text: '{scan_text}'")
    print("High attribution words (>= 0.5):")
    for a in attributions:
        if a["attribution"] >= 0.5:
            print(f" - {a['word']}: {a['attribution']}")
            
    # Check that critical words have high attribution
    high_words = [a['word'].lower() for a in attributions if a['attribution'] >= 0.5]
    assert any(w in high_words for w in ["cet1", "ratio", "swift", "gateway"]), "XAI failed to identify critical words."
    
    justification = xai.generate_auditor_justification("VIOLATION", "Basel III Capital Adequacy", results[0]["content"] if results else "Fallback context", attributions)
    print("Generated Justification Title:", justification["title"])
    assert "Compliance Alert" in justification["title"] or "Compliance Pass" in justification["title"]
    print("SUCCESS: XAI attributions verified.")
    print()

def test_byok_encryption():
    print("--- Testing BYOK Log Protection ---")
    sensitive_log = "User Viscount Bonsu accessed SWIFT gateway routing ID: FALSE_ROUTE_99"
    key = "CybersecSecretKey2026"
    
    encrypted = security.encrypt_log(sensitive_log, key)
    print(f"Original:  '{sensitive_log}'")
    print(f"Encrypted: '{encrypted}'")
    
    decrypted_correct = security.decrypt_log(encrypted, key)
    print(f"Decrypted (Correct Key): '{decrypted_correct}'")
    assert decrypted_correct == sensitive_log, "Decryption with correct key failed."
    
    decrypted_wrong = security.decrypt_log(encrypted, "WrongKey123")
    print(f"Decrypted (Wrong Key):   '{decrypted_wrong}'")
    assert decrypted_wrong != sensitive_log, "Decryption with wrong key should fail or mismatch."
    print("SUCCESS: BYOK data protection verified.")
    print()

if __name__ == "__main__":
    print("=== Running Backend Component Verification Tests ===")
    test_rag_retrieval()
    test_xai_attribution()
    test_byok_encryption()
    print("ALL TESTS PASSED SUCCESSFULLY!")
