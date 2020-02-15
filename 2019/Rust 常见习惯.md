# Rust 常见习惯

## clone
开源代码经常看到很多函数传参都会在变量后添加`.clone()`的调用，主要是为了变量的所有权转移的只是 clone 后的数据，让其在当前作用域的后段代码还能继续使用;而且 clone 方法调用后返回的是一个指针对象，方便传递参数
```rust
    fetch_testing_keypairs(range.clone()) // 如果这里不 clone，那需要写成*range

    fn fetch_testing_keypairs(
        &self,
        range: std::ops::Range<usize>,
    ) -> Result<Vec<Keypair>, String> {
        Ok(range.map(generate_deterministic_keypair).collect())
    }
```
