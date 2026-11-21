// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <string>
#include <cstddef>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/evp.h>
#endif
namespace integrity {
class Hash {
public:
  explicit Hash(bool sha1 = false) : sha1_(sha1) {
#ifdef __APPLE__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    valid_ = (sha1_ ? CC_SHA1_Init(&sha1_context_) : CC_SHA256_Init(&context_)) == 1;
#else
    context_ = EVP_MD_CTX_new();
    valid_ = context_ && EVP_DigestInit_ex(context_, sha1_ ? EVP_sha1() : EVP_sha256(), nullptr) == 1;
#endif
  }
  ~Hash() {
#ifndef __APPLE__
    EVP_MD_CTX_free(context_);
#endif
  }
  bool update(const void* bytes, std::size_t size) {
#ifdef __APPLE__
    valid_ = valid_ && (sha1_ ? CC_SHA1_Update(&sha1_context_, bytes, static_cast<CC_LONG>(size)) :
                      CC_SHA256_Update(&context_, bytes, static_cast<CC_LONG>(size))) == 1;
#else
    valid_ = valid_ && EVP_DigestUpdate(context_, bytes, size) == 1;
#endif
    return valid_;
  }
  std::string finish() {
    unsigned char digest[32];
    const unsigned wanted = sha1_ ? 20 : 32;
#ifdef __APPLE__
    if (!valid_ || (sha1_ ? CC_SHA1_Final(digest, &sha1_context_) : CC_SHA256_Final(digest, &context_)) != 1) return {};
#pragma clang diagnostic pop
#else
    unsigned size = 0;
    if (!valid_ || EVP_DigestFinal_ex(context_, digest, &size) != 1 || size != wanted) return {};
#endif
    constexpr char digits[] = "0123456789abcdef";
    std::string out(wanted*2, '0');
    for (unsigned i = 0; i < wanted; ++i) {
      out[2*i] = digits[digest[i] >> 4]; out[2*i+1] = digits[digest[i] & 15];
    }
    return out;
  }
private:
#ifdef __APPLE__
  CC_SHA256_CTX context_{};
  CC_SHA1_CTX sha1_context_{};
#else
  EVP_MD_CTX* context_ = nullptr;
#endif
  bool valid_ = false;
  bool sha1_ = false;
};
}
