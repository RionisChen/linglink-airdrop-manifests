#!/usr/bin/env node
/**
 * LingLink 空投名单校验脚本
 *
 * 作用：读取某一轮名单 JSON，按合约一致的算法重算 Merkle root，
 *       与名单内 merkleRoot 比对，证明名单内容与其声明的 root 一致。
 *       再把结果与链上 distributorAddress 合约的 merkleRoot 对比即可完成完整自证。
 *
 * 用法：
 *   node scripts/verify.js rounds/round-2.json
 *
 * 依赖：
 *   npm i ethers@6
 *
 * 叶子算法（与 AirdropDistributor 合约、后端建树一致）：
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, groupId, amount, unlockAt))))
 * 配对规则（OpenZeppelin 排序 pair）：
 *   pair = keccak256( min(a,b) || max(a,b) )
 * 建树顺序：叶子按名单 entries 给定顺序配对，不对叶子重新排序（与后端
 *   airdrop_merkle.go 的 buildTree 一致）；奇数个时末个节点上提。
 */

const fs = require("fs");
const { AbiCoder, keccak256, getBytes, concat } = require("ethers");

// 计算单片叶子哈希（双重 keccak256，防第二原像攻击）
function leafOf(recipient, groupId, amount, unlockAt) {
  const coder = AbiCoder.defaultAbiCoder();
  const inner = keccak256(
    coder.encode(
      ["address", "uint256", "uint256", "uint256"],
      [recipient, groupId, amount, unlockAt]
    )
  );
  // bytes.concat(inner) 后再 keccak256
  return keccak256(getBytes(inner));
}

// OpenZeppelin 排序 pair
function hashPair(a, b) {
  const [x, y] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([getBytes(x), getBytes(y)]));
}

// 由叶子数组自底向上算出 Merkle root。
//
// 关键：必须与后端 airdrop_merkle.go 的 buildTree 以及链上合约逐字节一致——
// 叶子按名单给定顺序（manifest.entries 的顺序，即后端建树时的 (wallet, group)
// 稳定排序顺序）两两配对，不对叶子本身重新排序；仅在每次配对内部用 OZ 排序 pair
// 决定 a||b 的拼接顺序。奇数个时末个节点直接上提到下一层。
function computeRoot(leaves) {
  if (leaves.length === 0) throw new Error("空名单");
  let level = [...leaves]; // 不排序叶子，保持名单给定顺序
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(hashPair(level[i], level[i + 1]));
      } else {
        next.push(level[i]); // 奇数个，末个上提
      }
    }
    level = next;
  }
  return level[0];
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("用法: node scripts/verify.js rounds/round-N.json");
    process.exit(1);
  }

  // 去除可能的 UTF-8 BOM，避免 JSON.parse 报错。
  const manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const { merkleRoot, entries, roundNo, leafCount, totalAmount } = manifest;

  // 基本对账
  if (leafCount !== undefined && leafCount !== entries.length) {
    console.warn(`⚠ leafCount(${leafCount}) 与实际条数(${entries.length})不一致`);
  }

  // 算叶子
  const leaves = entries.map((e) =>
    leafOf(e.recipient, e.groupId, e.amount, e.unlockAt)
  );

  // 重算 root
  const computed = computeRoot(leaves);

  // 总额对账
  const sum = entries.reduce((acc, e) => acc + BigInt(e.amount), 0n);

  console.log(`轮次         : ${roundNo}`);
  console.log(`名单条数     : ${entries.length}`);
  console.log(`总额(重算)   : ${sum.toString()}`);
  if (totalAmount !== undefined) {
    console.log(`总额(声明)   : ${totalAmount}  ${sum.toString() === totalAmount ? "✓" : "✗ 不一致"}`);
  }
  console.log(`root(声明)   : ${merkleRoot}`);
  console.log(`root(重算)   : ${computed}`);

  if (computed.toLowerCase() === merkleRoot.toLowerCase()) {
    console.log("\n✅ 校验通过：名单内容与其声明的 merkleRoot 一致。");
    console.log("   下一步：到区块浏览器读取 distributorAddress 合约的 merkleRoot，确认与上面一致即完成完整自证。");
  } else {
    console.log("\n❌ 校验失败：重算 root 与声明 root 不一致，名单可能被改动或算法不匹配。");
    process.exit(2);
  }
}

main();
