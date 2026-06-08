import sys
import os

# Ensure we can import modules from the current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import rag
import xai
import security

def test_rag_retrieval():
    print("--- Testing RAG Retrieval Accuracy ---")
    query = "What is the minimum Common Equity Tier 1 CET1 ratio?"
    results = rag.search_documents(query, limit=2)
    print(f"Query: '{query}'")
    print(f"Results found: {len(results)}")
    for i, r in enumerate(results):
        print(f" [{i+1}] Source: {r['filename']}, Score: {r['score']}")
        print(f"     Content snippet: {r['content'][:120]}...")
    
    # Assert we found the Basel III capital adequacy chunk
    assert len(results) > 0, "No results returned."
    assert "Basel_III_Capital.pdf" in [r['filename'] for r in results] or "Report_Format__21_.pdf" in [r['filename'] for r in results], "Failed to retrieve relevant Basel III docs."
    print("SUCCESS: RAG retrieval verified.")
    print()

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

def test_tpm_attestation():
    print("--- Testing TPM 2.0 Remote Attestation ---")
    nonce = "test-challenge-nonce-12345"
    quote = security.generate_simulated_tpm_quote(nonce)
    print("Generated TPM quote signature:", quote["signature"][:20] + "...")
    
    # Verify with correct nonce
    verify_result = security.verify_tpm_quote(quote, nonce)
    print("Verification result (Correct Nonce):", verify_result["reason"])
    assert verify_result["verified"] is True, "Attestation verification failed with correct nonce."
    
    # Verify with wrong nonce
    verify_wrong_nonce = security.verify_tpm_quote(quote, "wrong-nonce")
    print("Verification result (Wrong Nonce):  ", verify_wrong_nonce["reason"])
    assert verify_wrong_nonce["verified"] is False, "Attestation verification should fail with wrong nonce."
    
    # Verify with modified PCR (simulated breach)
    modified_quote = quote.copy()
    modified_quote["pcrs"] = quote["pcrs"].copy()
    modified_quote["pcrs"]["PCR0"] = "compromised_system_state_12345"
    verify_breached = security.verify_tpm_quote(modified_quote, nonce)
    print("Verification result (Modified PCR):  ", verify_breached["reason"])
    assert verify_breached["verified"] is False, "Attestation verification should fail with modified PCR."
    print("SUCCESS: TPM Remote Attestation verified.")
    print()

if __name__ == "__main__":
    print("=== Running Backend Component Verification Tests ===")
    test_rag_retrieval()
    test_xai_attribution()
    test_byok_encryption()
    test_tpm_attestation()
    print("ALL TESTS PASSED SUCCESSFULLY!")
